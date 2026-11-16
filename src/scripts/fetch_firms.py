#!/usr/bin/env python3
"""Baixa o histórico MODIS + VIIRS (FIRMS) de uma bbox, em blocos de 5 dias.

Configuração (arquivo .env na raiz do repo, fora do git):
    FIRMS_MAP_KEY_1=primeira_chave      # chaves lidas nesta ordem; vazias e repetidas saem
    FIRMS_MAP_KEY_2=segunda_chave       # a próxima só entra quando a atual estoura o limite
    FIRMS_MAP_KEY=outra_chave
    FIRMS_OUT_DIR=D:/dados/firms        # opcional; padrão: data/raw

Uso:
    python fetch_firms.py                      # Pantanal, MODIS 2001+ e VIIRS S-NPP 2012+
    python fetch_firms.py --out D:/outra/pasta # --out vence o .env
    python fetch_firms.py --region all         # as cinco regiões, uma após a outra

Saída: data/raw/<produto>/<ano>.csv (um cabeçalho por arquivo).
Pode ser interrompido e rodado de novo: anos já baixados são pulados.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
PANTANAL_BBOX = "-58.5,-22.5,-54.0,-15.5"  # west,south,east,north (aproximado; refinar depois)
# Esta tabela passa para mvh.regions na Task 12 do plano: manter uma cópia só.
# região -> (bbox "west,south,east,north", pasta bruta relativa à base)
REGION_BOXES: dict[str, tuple[str, str]] = {
    "pantanal": (PANTANAL_BBOX, ""),
    "indonesia": ("100.0,-4.0,116.0,3.0", "regions/indonesia"),
    "north_australia": ("122.0,-18.0,138.0,-11.0", "regions/north_australia"),
    "southern_africa": ("14.0,-17.0,30.0,-10.0", "regions/southern_africa"),
    "iberia": ("-10.0,36.0,3.0,43.0", "regions/iberia"),
}
AVAILABILITY_URL = "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv"
MAX_DAYS = 5  # limite da API por requisição

# produto -> (fonte SP, fonte NRT, data inicial)
PRODUCTS = {
    "modis": ("MODIS_SP", "MODIS_NRT", date(2001, 1, 1)),
    "viirs_snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", date(2012, 1, 20)),
}


_session = requests.Session()  # reaproveita a conexão/túnel: o proxy autentica bem menos vezes
PROXY_407_RETRIES = 4  # tentativas seguidas com 407 antes de desistir
PROXY_407_WAIT = 30  # segundos entre elas


class FatalError(RuntimeError):
    """Erro que não adianta repetir nem pular para o próximo ano (ex.: proxy 407)."""


class KeyLimitError(FatalError):
    """O FIRMS disse que a chave estourou o limite de transações."""


class InvalidKeyError(FatalError):
    """O FIRMS recusou a chave (Invalid MAP_KEY)."""


class KeysExhaustedError(FatalError):
    """Nenhuma chave sobrou."""


def _key_error(text: str) -> FatalError | None:
    """Erro de chave reconhecido na resposta do FIRMS (a mensagem nunca leva a chave)."""
    low = text.lower()
    if "transaction limit" in low:  # "Exceeding allowed transaction limit"
        return KeyLimitError("limite de transações da chave atingido")
    if "invalid map_key" in low:
        return InvalidKeyError("MAP_KEY inválida")
    return None


KEY_VARS = ("FIRMS_MAP_KEY_1", "FIRMS_MAP_KEY_2", "FIRMS_MAP_KEY")


def read_keys(env) -> list[str]:
    """Chaves de KEY_VARS, nesta ordem, sem vazias nem repetidas."""
    keys: list[str] = []
    for name in KEY_VARS:
        value = (env.get(name) or "").strip()
        if value and value not in keys:
            keys.append(value)
    return keys


WINDOW_SECONDS = 600  # o limite do FIRMS é por janela de 10 minutos
WINDOW_WAITS = 6  # esperas seguidas por pedido antes de desistir (cerca de 1 hora)


def wait_window(seconds: int) -> None:
    time.sleep(seconds)


class KeyRing:
    """Chaves em ordem; só avança quando a atual estoura o limite ou é recusada.

    "Invalid MAP_KEY" pode ser passageiro: a chave fica de fora só até o fim da janela e volta
    após a espera; se for recusada de novo na janela seguinte, sai de vez.
    """

    def __init__(self, keys: list[str]):
        self.keys = list(keys)
        self.index = 0
        self.invalid: set[int] = set()  # recusadas nesta janela
        self.prev_invalid: set[int] = set()  # recusadas na janela anterior
        self.dropped: set[int] = set()  # recusadas em duas janelas seguidas

    @property
    def current(self) -> str:
        return self.keys[self.index]

    def _alive(self) -> list[int]:
        return [i for i in range(len(self.keys)) if i not in self.dropped]

    def advance(self, why: str, invalid: bool = False) -> bool:
        """Passa à próxima chave útil. False: acabaram, mas há chave para tentar após a janela."""
        pos, total = self.index + 1, len(self.keys)
        if invalid:
            if self.index in self.prev_invalid:
                self.dropped.add(self.index)
                why += " de novo; chave descartada"
            else:
                self.invalid.add(self.index)
                why += " (vai tentar de novo após a espera)"
        print(f"chave {pos} de {total}: {why}", file=sys.stderr)
        if not self._alive():
            raise KeysExhaustedError(f"nenhuma das {total} chaves é válida")
        later = [i for i in self._alive() if i > self.index and i not in self.invalid]
        if not later:
            return False
        self.index = later[0]
        print(f"usando chave {self.index + 1} de {total}")
        return True

    def restart(self) -> None:
        """Nova janela: as chaves recusadas na anterior voltam a ser tentadas."""
        self.prev_invalid, self.invalid = self.invalid, set()
        self.index = self._alive()[0]
        print(f"usando chave {self.index + 1} de {len(self.keys)}")


def as_ring(key: str | KeyRing) -> KeyRing:
    return key if isinstance(key, KeyRing) else KeyRing([key])


def with_keys(key: str | KeyRing, fn):
    """fn(chave_atual); no limite ou chave inválida, passa à próxima e repete o mesmo pedido.

    Se todas as chaves estouraram o limite, espera a janela de 10 minutos e recomeça da primeira
    (até WINDOW_WAITS vezes por pedido); chave inválida nunca é repetida.
    """
    ring = as_ring(key)
    waits = 0
    while True:
        try:
            return fn(ring.current)
        except KeyLimitError as e:
            why, invalid = str(e), False
        except InvalidKeyError as e:
            why, invalid = str(e), True
        if ring.advance(why, invalid):
            continue
        if waits >= WINDOW_WAITS:
            raise KeysExhaustedError(
                f"limite de transações persiste após {WINDOW_WAITS} esperas de 10 minutos"
            )
        waits += 1
        print(
            f"Limite de transações atingido em todas as chaves; aguardando 10 minutos "
            f"({waits}/{WINDOW_WAITS}).",
            file=sys.stderr,
        )
        wait_window(WINDOW_SECONDS)
        ring.restart()


def fetch_chunk(key: str, source: str, bbox: str, start: date, days: int) -> str:
    url = f"{BASE}/{key}/{source}/{bbox}/{days}/{start.isoformat()}"
    last = "?"
    n407 = 0
    for attempt in range(8):
        try:
            r = _session.get(url, timeout=120)
            n407 = 0
            if r.status_code == 200:
                text = r.text.strip()
                if text and not text.lower().startswith("latitude"):
                    if (err := _key_error(text)) is not None:
                        raise err
                    # ex.: "Invalid MAP_KEY", "Exceeding allowed transaction limit"
                    last = f"resposta inesperada: {text[:120]}"
                    time.sleep(min(60, 5 * 2**attempt))
                    continue
                return text
            if (err := _key_error(r.text)) is not None:
                raise err
            last = f"HTTP {r.status_code}: {r.text[:120]}"
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 5 * 2**attempt))
                continue
            break  # erro definitivo (ex.: 400/401/403): não adianta repetir
        except requests.exceptions.ProxyError as e:
            msg = str(e).replace(key, "***")
            if "407" in msg:
                n407 += 1
                if n407 >= PROXY_407_RETRIES:
                    raise FatalError(
                        f"O proxy continua respondendo 407 após {PROXY_407_RETRIES} tentativas. "
                        "Confira: (1) senha com caractere especial precisa de URL-encoding "
                        "(@ vira %40, # vira %23); (2) sessão/token do proxy expirou; "
                        "(3) a rede limita volume: troque para hotspot e rode de novo."
                    ) from None
                print(
                    f"[proxy 407] aguardando {PROXY_407_WAIT}s ({n407}/{PROXY_407_RETRIES})...",
                    file=sys.stderr,
                )
                time.sleep(PROXY_407_WAIT)
                continue
            last = f"ProxyError: {msg[:200]}"
            time.sleep(min(60, 5 * 2**attempt))
        except requests.RequestException as e:
            last = f"{type(e).__name__}: {str(e).replace(key, '***')[:200]}"
            time.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError(f"{last} | {url.replace(key, '***')}")


def fetch_range(key: str | KeyRing, source: str, bbox: str, start: date, end: date) -> list[str]:
    """Linhas CSV (sem cabeçalho) de start..end inclusive; devolve [header, ...linhas]."""
    out: list[str] = []
    cur = start
    while cur <= end:
        days = min(MAX_DAYS, (end - cur).days + 1)
        text = with_keys(key, lambda k, c=cur, d=days: fetch_chunk(k, source, bbox, c, d))
        lines = text.splitlines()
        if lines:
            if not out:
                out.append(lines[0])
            out.extend(lines[1:])
        cur += timedelta(days=days)
        time.sleep(0.05)
    return out


def year_segments(start: date, end: date):
    for year in range(start.year, end.year + 1):
        yield year, max(start, date(year, 1, 1)), min(end, date(year, 12, 31))


def fetch_availability(key: str) -> dict[str, tuple[date, date]]:
    """Dias que cada fonte do FIRMS guarda: data_id -> (min_date, max_date)."""
    url = f"{AVAILABILITY_URL}/{key}/ALL"
    try:
        r = _session.get(url, timeout=120)
    except requests.RequestException as e:
        msg = str(e).replace(key, "***")[:200]
        raise FatalError(f"data_availability falhou: {type(e).__name__}: {msg}") from None
    if (err := _key_error(r.text)) is not None:
        raise err
    if r.status_code != 200:
        raise FatalError(f"data_availability: HTTP {r.status_code}: {r.text[:120]}")
    reader = csv.DictReader(io.StringIO(r.text.strip()))
    if not {"data_id", "min_date", "max_date"} <= set(reader.fieldnames or ()):
        raise FatalError(f"data_availability: resposta inesperada: {r.text.strip()[:120]}")
    wanted = {src for sp, nrt, _ in PRODUCTS.values() for src in (sp, nrt)}
    got: dict[str, tuple[date, date]] = {}
    for row in reader:
        data_id = row["data_id"]
        if data_id not in wanted:  # linhas de outras fontes podem ter datas vazias
            continue
        if data_id in got:
            raise FatalError(f"data_availability: {data_id} aparece mais de uma vez")
        try:
            got[data_id] = (
                date.fromisoformat(row["min_date"]),
                date.fromisoformat(row["max_date"]),
            )
        except (ValueError, TypeError):
            raise FatalError(f"data_availability: data inválida em {data_id}") from None
    if wanted - got.keys():
        raise FatalError(f"data_availability sem as fontes: {sorted(wanted - got.keys())}")
    return got


Span = tuple[date, date]


def split_segment(y0: date, y1: date, sp: Span, nrt: Span) -> tuple[Span | None, Span | None]:
    """Parte SP e parte NRT de y0..y1; dias que nenhuma fonte guarda ficam de fora."""
    one = timedelta(days=1)
    sp_part = (y0, min(y1, sp[1]))
    nrt_part = (max(y0, sp[1] + one, nrt[0]), min(y1, nrt[1]))
    return (
        sp_part if sp_part[0] <= sp_part[1] else None,
        nrt_part if nrt_part[0] <= nrt_part[1] else None,
    )


def _coverage_key(product: str) -> str:
    return "viirs" if product == "viirs_snpp" else product


def _read_coverage(out_dir: Path) -> dict:
    path = out_dir / "coverage.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _intervals(entry: dict) -> list[Span]:
    return [(date.fromisoformat(a), date.fromisoformat(b)) for a, b in entry.get("intervals", [])]


def record_coverage(
    out_dir: Path, product: str, year: int, spans: list[Span], nrt_start: date | None
) -> None:
    """Regrava coverage.json: troca os intervalos do produto dentro de `year` por `spans`."""
    data = _read_coverage(out_dir)
    entry = data.setdefault(_coverage_key(product), {"intervals": [], "nrt_start": None})
    one = timedelta(days=1)
    y_first, y_last = date(year, 1, 1), date(year, 12, 31)
    kept: list[Span] = []
    for a, b in _intervals(entry):  # a parte dentro do ano sai
        if a < y_first:
            kept.append((a, min(b, y_first - one)))
        if b > y_last:
            kept.append((max(a, y_last + one), b))
    merged: list[Span] = []
    for a, b in sorted(kept + list(spans)):
        if merged and a <= merged[-1][1] + one:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    entry["intervals"] = [[a.isoformat(), b.isoformat()] for a, b in merged]
    if nrt_start is not None:
        entry["nrt_start"] = nrt_start.isoformat()
    tmp = out_dir / "coverage.json.tmp"
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(out_dir / "coverage.json")


def _year_has_record(out_dir: Path, product: str, year: int) -> bool:
    entry = _read_coverage(out_dir).get(_coverage_key(product), {})
    return any(a.year <= year <= b.year for a, b in _intervals(entry))


def run(
    key: str | KeyRing, bbox: str, out_dir: Path, today: date, availability: dict | None = None
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if availability is None:
        try:
            availability = with_keys(key, fetch_availability)
        except FatalError as e:
            print(f"\n[PARADO] {e}", file=sys.stderr)
            raise SystemExit(3) from e
    failed: list[str] = []
    for name, (sp_src, nrt_src, first) in PRODUCTS.items():
        folder = out_dir / name
        folder.mkdir(parents=True, exist_ok=True)
        sp_av, nrt_av = availability[sp_src], availability[nrt_src]
        for year, y0, y1 in year_segments(first, today - timedelta(days=1)):
            target = folder / f"{year}.csv"
            sp_part, nrt_part = split_segment(y0, y1, sp_av, nrt_av)
            if target.exists() and year < today.year:
                print(f"[skip] {name} {year}")
                if sp_part and not _year_has_record(out_dir, name, year):
                    record_coverage(out_dir, name, year, [sp_part], None)
                continue
            try:
                rows: list[str] = []
                for src, part in ((sp_src, sp_part), (nrt_src, nrt_part)):
                    if part is None:
                        continue
                    got = fetch_range(key, src, bbox, *part)
                    rows = rows + (got[1:] if rows else got)
            except FatalError as e:
                print(f"\n[PARADO] {e}", file=sys.stderr)
                print(
                    f"Parou em {name} {year}. Rode de novo: os anos prontos são pulados.",
                    file=sys.stderr,
                )
                raise SystemExit(3) from e
            except RuntimeError as e:  # não grava arquivo parcial; segue para o próximo ano
                print(f"[FALHOU] {name} {year}: {e}", file=sys.stderr)
                failed.append(f"{name} {year}")
                continue
            tmp = target.with_suffix(".tmp")
            tmp.write_text("\n".join(rows) + ("\n" if rows else ""))
            tmp.replace(target)  # escrita atômica: arquivo existente = ano completo
            spans = [p for p in (sp_part, nrt_part) if p is not None]
            record_coverage(out_dir, name, year, spans, nrt_part[0] if nrt_part else None)
            print(f"[ok]   {name} {year}: {max(len(rows) - 1, 0)} focos")
    if failed:
        print(
            f"\nAnos pendentes: {', '.join(failed)}. Rode de novo para completar.",
            file=sys.stderr,
        )
        raise SystemExit(2)


def today() -> date:
    return date.today()


def load_dotenv(path: Path = Path(".env")) -> None:
    """Lê KEY=valor de um .env (sem dependência). Variáveis já definidas no terminal vencem."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def resolve_target(
    region: str | None, bbox: str | None, out: Path | None, base: Path
) -> tuple[str, Path]:
    """(bbox, pasta de saída): da região, se dada; senão --bbox/--out ou os padrões."""
    if region is None:
        return bbox or PANTANAL_BBOX, out if out is not None else base
    if region not in REGION_BOXES:
        print(
            f"Região desconhecida: {region!r}. Opções: {', '.join(REGION_BOXES)}",
            file=sys.stderr,
        )
        raise SystemExit(2)
    box, folder = REGION_BOXES[region]
    return box, base / folder if folder else base


def run_all(ring: KeyRing, base: Path) -> int:
    """As cinco regiões em ordem, com a mesma rotação de chaves; para se uma parar (código 3)."""
    done: list[str] = []
    pending: list[str] = []
    for region in REGION_BOXES:
        bbox, out_dir = resolve_target(region, None, None, base)
        print(f"\n=== {region} ===")
        try:
            run(ring, bbox, out_dir, today())
        except SystemExit as e:
            if e.code != 3:
                pending.append(region)  # anos pendentes: vale rodar de novo, mas segue
                continue
            stopped = list(REGION_BOXES)[len(done) + len(pending) :]
            print(f"\nRegiões concluídas: {', '.join(done) or '-'}", file=sys.stderr)
            print(f"Regiões não concluídas: {', '.join(stopped)}", file=sys.stderr)
            return 3
        done.append(region)
    if pending:
        print(f"\nRegiões com anos pendentes: {', '.join(pending)}", file=sys.stderr)
        return 2
    return 0


def main() -> int:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", help=f"região pronta ({', '.join(REGION_BOXES)}) ou all")
    ap.add_argument("--bbox", help="west,south,east,north (padrão: Pantanal)")
    ap.add_argument(
        "--out",
        type=Path,
        help="pasta de saída (padrão: FIRMS_OUT_DIR do .env, senão data/raw)",
    )
    args = ap.parse_args()
    if args.region and (args.bbox or args.out):
        ap.error("--region não combina com --bbox nem com --out")
    base = Path(os.environ.get("FIRMS_OUT_DIR", "data/raw"))
    target = (
        None if args.region == "all" else resolve_target(args.region, args.bbox, args.out, base)
    )
    keys = read_keys(os.environ)
    if not keys:
        print(f"Defina uma chave: {', '.join(KEY_VARS)}", file=sys.stderr)
        return 1
    ring = KeyRing(keys)
    print(f"usando chave 1 de {len(keys)}")
    if target is None:
        return run_all(ring, base)
    run(ring, target[0], target[1], today())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

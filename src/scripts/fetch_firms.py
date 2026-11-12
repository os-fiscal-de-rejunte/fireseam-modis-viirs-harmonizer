#!/usr/bin/env python3
"""Baixa o histórico MODIS + VIIRS (FIRMS) de uma bbox, em blocos de 5 dias.

Configuração (arquivo .env na raiz do repo, fora do git):
    FIRMS_MAP_KEY=sua_chave
    FIRMS_OUT_DIR=D:/dados/firms        # opcional; padrão: data/raw

Uso:
    python fetch_firms.py                      # Pantanal, MODIS 2001+ e VIIRS S-NPP 2012+
    python fetch_firms.py --out D:/outra/pasta # --out vence o .env

Saída: data/raw/<produto>/<ano>.csv (um cabeçalho por arquivo).
Pode ser interrompido e rodado de novo: anos já baixados são pulados.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
PANTANAL_BBOX = "-58.5,-22.5,-54.0,-15.5"  # west,south,east,north (aproximado; refinar depois)
SP_LAG_DAYS = 150  # a versão "Standard Processing" chega com ~5 meses de atraso
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
                    # ex.: "Invalid MAP_KEY", "Exceeding allowed transaction limit"
                    last = f"resposta inesperada: {text[:120]}"
                    time.sleep(min(60, 5 * 2**attempt))
                    continue
                return text
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


def fetch_range(key: str, source: str, bbox: str, start: date, end: date) -> list[str]:
    """Linhas CSV (sem cabeçalho) de start..end inclusive; devolve [header, ...linhas]."""
    out: list[str] = []
    cur = start
    while cur <= end:
        days = min(MAX_DAYS, (end - cur).days + 1)
        text = fetch_chunk(key, source, bbox, cur, days)
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


def run(key: str, bbox: str, out_dir: Path, today: date) -> None:
    sp_end = today - timedelta(days=SP_LAG_DAYS)
    failed: list[str] = []
    for name, (sp_src, nrt_src, first) in PRODUCTS.items():
        folder = out_dir / name
        folder.mkdir(parents=True, exist_ok=True)
        for year, y0, y1 in year_segments(first, today - timedelta(days=1)):
            target = folder / f"{year}.csv"
            if target.exists() and year < today.year:
                print(f"[skip] {name} {year}")
                continue
            try:
                rows: list[str] = []
                if y0 <= sp_end:
                    rows = fetch_range(key, sp_src, bbox, y0, min(y1, sp_end))
                if y1 > sp_end:
                    nrt = fetch_range(key, nrt_src, bbox, max(y0, sp_end + timedelta(days=1)), y1)
                    rows = rows + (nrt[1:] if rows else nrt)
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
            print(f"[ok]   {name} {year}: {max(len(rows) - 1, 0)} focos")
    if failed:
        print(
            f"\nAnos pendentes: {', '.join(failed)}. Rode de novo para completar.",
            file=sys.stderr,
        )
        raise SystemExit(2)


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


def main() -> int:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default=PANTANAL_BBOX, help="west,south,east,north")
    ap.add_argument(
        "--out",
        default=os.environ.get("FIRMS_OUT_DIR", "data/raw"),
        type=Path,
        help="pasta de saída (padrão: FIRMS_OUT_DIR do .env, senão data/raw)",
    )
    args = ap.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        print("Defina FIRMS_MAP_KEY (export FIRMS_MAP_KEY=...)", file=sys.stderr)
        return 1
    run(key, args.bbox, args.out, date.today())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Changelog

## 1.0.0 (2026-11-16)


### ✨ Features

* add modis and viirs firms historical data fetcher ([a460641](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/a46064178cd5b60b414a4f31866d304f6b0a7d34))
* add modis and viirs firms historical data fetcher ([594897c](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/594897cf3897d660ead7dd10c73d498dd6ca75c9))
* **data:** add export contract, validator and sample export ([51250d2](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/51250d276c2707c0672b989a300feb1402573713))
* **model:** add pyro forecast adapter and outlook data ([ac0f416](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/ac0f4163951b58a68fc1bc3931cada500bfda295))
* **model:** add uncertainty band to estimated weeks ([1905899](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/19058994ab817b56291118557ec1887748146046))
* **model:** add weekly harmonizer with leave-one-year-out validation ([0bb694f](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/0bb694fdef32f894a2bcb68eb209c24c813d7ee6))
* **pipeline:** add aqua and s-npp ghost pairing ([1014a9b](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/1014a9bb04a20fcc9cf09bbca38121b45a2e2cf1))
* **pipeline:** add firms csv ingestion ([7ace149](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/7ace149ae91f033a47c456390c9190136e27ef83))
* **pipeline:** add raw firms data audit ([27627d3](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/27627d351d14d699f6fa2d74c710ca4c01c344a6))
* **pipeline:** add space-time fire events ([e6e7d10](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/e6e7d10d445341cdaae2b45d598ecef38bce6e54))
* **pipeline:** add static export entry point ([60f9c06](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/60f9c0662239c55c829c71ff569d43a8984f15d9))
* **pipeline:** add the region registry and export by region ([f350e25](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/f350e25cb9bfa40f14475f3845c97a9bfc6dedd6))
* **pipeline:** add weekly grid cube ([ec3dced](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/ec3dcedc9a1cefe9618c87cc7fc00adaee6f8c06))
* **pipeline:** export sparse cell by week cube ([98f760c](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/98f760c9c3d06b417566c67d70d1eab4b495d685))
* **pipeline:** fetch firms by availability and record coverage ([85f6d78](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/85f6d78c2beb03a6795b59bcf4ad74c2c0cf5eb9))
* **pipeline:** measure the pantanal reference counts ([8329c0f](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/8329c0fc64524fc3d78ae2d6244176af93de09e2))
* **pipeline:** write the regions index with acceptance states ([614e1b3](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/614e1b36d05123e77d639ee741a201eafc1dd4ee))
* **web:** add globe, calendar heatmap, sonification and outlook ([3ee1ae4](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/3ee1ae45d06128dfff410878575dcbf4b45ce4c1))
* **web:** add reading quality and the retrospective alert test ([a27cc8b](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/a27cc8b80d80dd92689e3bee03ed1eb20dc7775e))
* **web:** add the manager briefing in english and portuguese ([c60324f](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/c60324ff6357da8373756f27c4ceee9b228d032b))
* **web:** compute the calendar of a selected area ([c479d63](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/c479d63c990f605405f45cbffcf62c39aa29d6b5))
* **web:** dim detections outside the selected area ([d9f251b](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/d9f251b02e2893c0f034de3d9ab1e43e2e889107))
* **web:** draw and drag a selection area on the globe ([8a750d9](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/8a750d9e647026525d26a7df9e4ff9f6cf2bb546))
* **web:** export the active calendar as csv ([03a1eda](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/03a1eda52f162026857057c03ba6c8141aff70a7))
* **web:** flag unusual weeks and the critical period ([c88b191](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/c88b191d8b6f094429fb00178e3201fc13e61ca8))
* **web:** let the charts swap calendars and mark weeks ([1f413e6](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/1f413e6c7864803cdc81e5c147c3809f132077dd))
* **web:** load regions, rank them and total detections per cell ([eb7de5f](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/eb7de5fadcd9c77bd7471d27b169bc0bd6c7fee7))
* **web:** load the cell by week cube ([3bce8e7](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/3bce8e76d78747d40cb21f79781598d7e7935828))
* **web:** open on a planet cover and switch between regions ([835d2c0](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/835d2c0eb99cc6010a5f09266bc35082a8ed997d))
* **web:** select an area and see its calendar ([39ce462](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/39ce46277e46065896134317a777e29edf2c98e4))


### 🐛 Fixes

* **web:** cancel a drag that starts or ends off the globe ([a54107b](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/a54107b3c9e189e1b077242a0a673113775af0a3))
* **web:** name failing data files and show the week percentile ([833ebf3](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/833ebf37ca16ef97b72370422acbae8357bbef63))
* **web:** name the cube file on every load failure ([097c306](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/097c306d6079c1007eb73d8a5872e81220313715))
* **web:** restore the area outline after a cancelled drag ([b131287](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/b1312875ac3d7bbb8782d9027e862d66e59b8d84))


### 📊 Data

* **data:** refresh the sample export and add a synthetic region ([9454377](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/9454377a06146584bd5fe01d8d6156654b1e90ee))
* **web:** add cube and uncertainty band to the export ([bbd6a43](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/bbd6a43f03b8e2bf727404a563ba4b0961f4d15c))
* **web:** add harmonized pantanal export 2001-2026 ([ca8f8d5](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/ca8f8d5e0b87e8782d8376de0b4ce3069f60d442))
* **web:** add iberia, indonesia, north australia and southern africa ([e103100](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/e103100bc6bcd862379f4f028c489ac47524aa3c))
* **web:** re-base the pantanal export on the 2026 download ([8317254](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/8317254f286cdc62c779bea543f4b099abb23f06))


### 📝 Docs

* **docs:** add area-of-interest implementation plan ([001c5a8](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/001c5a8dfb8080abe59899cdb816bbcea907a737))
* **docs:** add as-built record and area-of-interest design spec ([81ef342](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/81ef34223edab9d5cbcae0f2e423d126199a40d9))
* **docs:** add project readme, pitch script and slides outline ([d066445](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/d0664451f3f52ce9a1d60138aeaedb232dcd4e20))
* **docs:** add the data audit of each new region ([d134e87](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/d134e87b4b021d1d01f1dbf9e28655cce29cca97))
* **docs:** cite official sources and time the area beat in the pitch ([fb2769a](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/fb2769aa57b23a6f9df21859263cecf228b6536a))
* **docs:** document area selection and unusual weeks ([2fbf3e5](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/2fbf3e57410f875c83e6bd526ef44337c91a1d46))
* **docs:** format python blocks in the plan ([4deec4b](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/4deec4bc41918c60f72a538d4daa18b554263487))
* **docs:** point the readme at the fireseam repository ([44003f5](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/44003f5df34988c69bcda4016ab0b8967c33f963))
* **docs:** rename the project to fireseam and rewrite the pitch ([80d9376](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/80d93766a1d7f9a4b42455464a3c5bcd73cade4f))
* **docs:** say the 2027 end of modis science is projected ([95e77c6](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/95e77c63a45d03e87a17fbc85163d4e7f1bad62e))
* **docs:** state the reference-count rule and the select step ([3fe0673](https://github.com/os-fiscal-de-rejunte/fireseam-modis-viirs-harmonizer/commit/3fe06737c4cd2e8256bdb7c400f4e06099d5cc72))

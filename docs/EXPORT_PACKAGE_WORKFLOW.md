# HumanOrigin — Export Package Workflow

## Current stable proof strategy

HumanOrigin currently exports two proof files in parallel:

- `CERTIFICAT_FINAL.v1.ho.json` = preferred portable standardized proof format (HO-JSON v1)
- `CERTIFICAT_FINAL.ho.json` = legacy compatibility proof format

The public verifier accepts both formats.

## Current stable rule

The Core app remains untouched for package-transition work.

Package clarity and migration messaging are handled through a post-export step.

## Current recommended workflow

1. Run the normal final project export from the app.
2. Keep the exported package intact.
3. Run the package post-processing tool:
   - `tools/patch_latest_export_package.py`
4. This updates:
   - `HumanOrigin_READ_ME_FIRST.txt`
   - `HumanOrigin_VERIFY.txt`
   - `HumanOrigin_MANIFEST.json`

## Product interpretation

- HO-JSON v1 is now the preferred portable proof format.
- Legacy `.ho.json` remains included for compatibility.
- Visible assets and published copies are circulation assets, not the reference proof.

## Migration rule

Do not replace the legacy `.ho.json` in the Core app yet.
Keep dual-format export until the migration is fully stabilized.

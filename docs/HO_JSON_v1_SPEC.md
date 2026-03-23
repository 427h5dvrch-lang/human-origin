# HO-JSON v1 — HumanOrigin Portable Proof Format

## Role

CERTIFICAT_FINAL.v1.ho.json is the preferred portable standardized proof format of HumanOrigin.

It is the reference portable proof format during the transition phase, while CERTIFICAT_FINAL.ho.json remains included as a legacy compatibility proof.

## Core structure

A valid HO-JSON v1 file follows this structure:

- format = humanorigin-hojson
- version = 1.0
- payload = signed proof payload
- payload_sha256 = SHA-256 of canonical payload
- signatures = signature set verifying the payload hash

## Document binding

The external source document is bound through document.sha256.

## Verification

Verification method for v1:
- canonicalize payload
- compute SHA-256
- compare with payload_sha256
- verify Ed25519 signature against that payload hash

## Transition rule

Current stable export strategy:
- CERTIFICAT_FINAL.v1.ho.json = preferred standardized portable proof
- CERTIFICAT_FINAL.ho.json = legacy compatibility proof

The public verifier accepts both formats.

## Product rule

Visible assets and circulation assets are not the reference proof.

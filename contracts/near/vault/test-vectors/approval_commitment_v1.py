"""Independent encoder for Kinwarden approval commitment v1 test vectors.

Implements docs/near/STATE_AND_ENCODING.md section 6 directly from the Borsh
rules (strings: u32 little-endian length + UTF-8; integers: little-endian), with
no NEAR or Borsh library, so the Rust contract and TypeScript client are checked
against a separate implementation. Run: python approval_commitment_v1.py
"""
import hashlib
import json
import pathlib

FIELDS = [
    ("domain", "string"),
    ("network", "string"),
    ("vault", "string"),
    ("case_id", "string"),
    ("invoice_id", "string"),
    ("proposal_id", "u64"),
    ("attempt", "u32"),
    ("token", "string"),
    ("recipient", "string"),
    ("amount", "u128"),
    ("expires_at", "u64"),
    ("policy_version", "u64"),
    ("payee_version", "u64"),
]
WIDTH = {"u32": 4, "u64": 8, "u128": 16}

BASE = {
    "domain": "kinwarden.approval.v1",
    "network": "testnet",
    "vault": "vault.kinwarden-demo.testnet",
    "case_id": "case-th-hosp-001",
    "invoice_id": "inv-bih-2026-0042",
    "proposal_id": "7",
    "attempt": "1",
    "token": "tusdc.kinwarden-demo.testnet",
    "recipient": "bangkok-intl-hospital.kinwarden-demo.testnet",
    "amount": "250000000",
    "expires_at": "1794067200000000000",
    "policy_version": "3",
    "payee_version": "2",
}

# One vector per field, each changing only that field.
CHANGES = {
    "domain": "kinwarden.approval.v2",
    "network": "mainnet",
    "vault": "vault2.kinwarden-demo.testnet",
    "case_id": "case-th-hosp-002",
    "invoice_id": "inv-bih-2026-0043",
    "proposal_id": "8",
    "attempt": "2",
    "token": "tusdc2.kinwarden-demo.testnet",
    "recipient": "bangkok-intl-hospita1.kinwarden-demo.testnet",
    "amount": "250000001",
    "expires_at": "1794067200000000001",
    "policy_version": "4",
    "payee_version": "3",
}

EXTRA = {
    "max_integers": {
        "proposal_id": str(2**64 - 1),
        "attempt": str(2**32 - 1),
        "amount": str(2**128 - 1),
        "expires_at": str(2**64 - 1),
        "policy_version": str(2**64 - 1),
        "payee_version": str(2**64 - 1),
    },
    "sandbox_network": {"network": "sandbox", "vault": "vault.test.near", "token": "tusdc.test.near"},
}


def encode(values):
    out = bytearray()
    for name, kind in FIELDS:
        value = values[name]
        if kind == "string":
            data = value.encode("utf-8")
            out += len(data).to_bytes(4, "little") + data
        else:
            out += int(value).to_bytes(WIDTH[kind], "little")
    return bytes(out)


def vector(name, values):
    encoded = encode(values)
    return {
        "name": name,
        "input": values,
        "borsh_hex": encoded.hex(),
        "sha256_hex": hashlib.sha256(encoded).hexdigest(),
    }


def main():
    vectors = [vector("base", dict(BASE))]
    for field, changed in CHANGES.items():
        vectors.append(vector(f"changed_{field}", {**BASE, field: changed}))
    for name, overrides in EXTRA.items():
        vectors.append(vector(name, {**BASE, **overrides}))
    doc = {
        "format": "kinwarden approval commitment v1: sha256(borsh(fields in order))",
        "spec": "docs/near/STATE_AND_ENCODING.md section 6",
        "fields": [f"{n}:{k}" for n, k in FIELDS],
        "note": "Integers are decimal strings in JSON. Fictional accounts; not real institutions.",
        "vectors": vectors,
    }
    path = pathlib.Path(__file__).with_suffix(".json")
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} vectors to {path.name}")


if __name__ == "__main__":
    main()

//! Stable refusal codes. Tests assert the code prefix, never only the text.
//! See docs/near/STATE_AND_ENCODING.md §7.

pub const ONE_YOCTO: &str = "E_ONE_YOCTO: attach exactly 1 yoctoNEAR";
pub const STORAGE_DEPOSIT: &str = "E_STORAGE_DEPOSIT: attach enough NEAR to cover storage";
pub const NOT_OWNER: &str = "E_NOT_OWNER: caller is not the case owner";
pub const NOT_VERIFIER: &str = "E_NOT_VERIFIER: caller is not the verifier";
pub const ROLE_CONFLICT: &str = "E_ROLE_CONFLICT: roles must be distinct accounts";
pub const BAD_NETWORK: &str = "E_BAD_NETWORK: network must be sandbox, testnet or mainnet";
pub const ID_FORMAT: &str = "E_ID_FORMAT: identifiers are opaque: 1-64 of a-z, 0-9, '-'";
pub const PROVENANCE_FORMAT: &str =
    "E_PROVENANCE_FORMAT: provenance is a 64-char lowercase hex digest";
pub const CASE_EXISTS: &str = "E_CASE_EXISTS: case id already used";
pub const CASE_NOT_FOUND: &str = "E_CASE_NOT_FOUND: no such case";
pub const LIMITS_INVALID: &str =
    "E_LIMITS_INVALID: limits must be positive and per-payment <= rolling <= lifetime";
pub const LIMITS_NOT_LOWER: &str = "E_LIMITS_NOT_LOWER: limits can only be lowered";
pub const PAYEE_EXISTS: &str = "E_PAYEE_EXISTS: payee is enrolled or pending";
pub const PAYEE_NOT_FOUND: &str = "E_PAYEE_NOT_FOUND: no such payee";
pub const PAYEE_ACCOUNT_IN_USE: &str = "E_PAYEE_ACCOUNT_IN_USE: account belongs to another payee";
pub const PAYEE_FORBIDDEN_ACCOUNT: &str =
    "E_PAYEE_FORBIDDEN_ACCOUNT: vault, token, agent and verifier cannot be payees";
pub const PAYEE_NOT_ACTIVE: &str = "E_PAYEE_NOT_ACTIVE: payee is not active";
pub const INVOICE_EXISTS: &str = "E_INVOICE_EXISTS: invoice id already used";
pub const INVOICE_NOT_FOUND: &str = "E_INVOICE_NOT_FOUND: no such invoice";
pub const INVOICE_NOT_AUTHORIZED: &str = "E_INVOICE_UNAUTHORIZED: invoice is not authorized";
pub const AMOUNT: &str = "E_AMOUNT: amount must be positive";
pub const AMOUNT_OVERFLOW: &str = "E_AMOUNT_OVERFLOW: amount overflow";
pub const WRONG_TOKEN: &str = "E_WRONG_TOKEN: only the configured token may deposit";
pub const NOT_AGENT: &str = "E_NOT_AGENT: caller is not the agent";
pub const AGENT_DISABLED: &str = "E_AGENT_DISABLED: the owner switched the agent off";
pub const PAUSED: &str = "E_PAUSED: the case is paused";
pub const TTL: &str = "E_TTL: proposal lifetime must be 1 to 86400 seconds";
pub const INVOICE_CASE_MISMATCH: &str = "E_INVOICE_CASE_MISMATCH: invoice belongs to another case";
pub const INVOICE_CEILING: &str = "E_INVOICE_CEILING: invoice ceiling exceeded";
pub const CAP_PAYMENT: &str = "E_CAP_PAYMENT: per-payment limit exceeded";
pub const CAP_ROLLING: &str = "E_CAP_ROLLING: rolling 24-hour case limit exceeded";
pub const CAP_GROUP: &str = "E_CAP_GROUP: rolling 24-hour purpose-group limit exceeded";
pub const CAP_LIFETIME: &str = "E_CAP_LIFETIME: lifetime case limit exceeded";
pub const LIQUIDITY: &str = "E_LIQUIDITY: not enough unreserved funds in the case";
pub const BOUND_ACTIVE: &str = "E_BOUND_ACTIVE: too many proposals awaiting approval";
pub const BOUND_RATE: &str = "E_BOUND_RATE: too many proposals in 24 hours";
pub const REQUEST_ID_CONFLICT: &str =
    "E_REQUEST_ID_CONFLICT: request id reused with different content";
pub const PROPOSAL_NOT_FOUND: &str = "E_PROPOSAL_NOT_FOUND: no such proposal in this case";
pub const BAD_STATE: &str = "E_BAD_STATE: proposal is not awaiting approval";
pub const EXPIRED: &str = "E_EXPIRED: proposal has expired";
pub const STALE_POLICY: &str = "E_STALE_POLICY: policy changed since the proposal";
pub const PAYEE_CHANGED: &str = "E_PAYEE_CHANGED: payee changed or is no longer active";
pub const FIELD_MISMATCH: &str =
    "E_FIELD_MISMATCH: approved recipient, token or amount differs from the proposal";
pub const COMMITMENT_MISMATCH: &str =
    "E_COMMITMENT_MISMATCH: approval hash does not match the stored proposal";
pub const GAS: &str = "E_GAS: attach at least 100 TGas";
/// Recorded as a status reason, not raised as a panic.
pub const TRANSFER_FAILED: &str =
    "E_TRANSFER_FAILED: the token transfer failed; funds stay in the case";

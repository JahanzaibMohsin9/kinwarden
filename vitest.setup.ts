import path from "node:path";

// Each test worker gets its own data dir, so parallel files don't read each other's half-written world.json.
process.env.KINWARDEN_DATA_DIR = path.resolve(process.cwd(), ".data-test", `w${process.env.VITEST_POOL_ID ?? "0"}`);

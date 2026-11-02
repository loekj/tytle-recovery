// SPDX-License-Identifier: GPL-3.0-only
//
// Public addresses on Gnosis (chainId 100). Each one is checked on the chain
// before it is relied on: the fixtures record its code and the code's keccak256.

/** Candide SocialRecoveryModule v0.0.1, 14-day wait: the deployed, verified copy we reproduce. */
export const DEPLOYED_14_DAY_MODULE = '0x9BacD92F4687Db306D7ded5d4513a51EA05df25b';

/** The transaction that created it (Sourcify `deployment`, checked on the chain by record-fixtures). */
export const DEPLOYED_14_DAY_MODULE_CREATION_TX = '0x2a01791fbd4ad81cff21d9b53a86cd47812a56e3d1a71f174e6640ac90cb7e81';

/**
 * The transaction that deployed the exit copy (the 90-day copy at the page's EXIT_MODULE) through Safe's singleton
 * factory. record-fixtures checks on the chain that it made exactly that address.
 */
export const EXIT_MODULE_CREATION_TX = '0x4c72845ad71c59d7668e312b316051274f43f8119881a98c85f11868cd55e4ba';

/**
 * CREATE2 factories on Gnosis. Both have the same 69-byte code: call data = a
 * 32-byte salt, then the init code; the new contract lands at
 * keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:].
 */
export const SAFE_SINGLETON_FACTORY = '0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7';
export const ARACHNID_DETERMINISTIC_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

export const RECOVERY_PERIOD_14_DAYS = 1_209_600n; // 0x127500
export const RECOVERY_PERIOD_90_DAYS = 7_776_000n; // 0x76A700

/** Safe 1.4.1, the canonical deployment on Gnosis (Sourcify: exact match). A Tytle account is a proxy to SafeL2. */
export const SAFE_L2_SINGLETON_141 = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762';
export const SAFE_PROXY_FACTORY_141 = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67';
export const COMPATIBILITY_FALLBACK_HANDLER_141 = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99';

/** The Safe 4337 module: a Tytle account has it as a module and as its fallback handler. */
export const SAFE_4337_MODULE = '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226';

/**
 * Monerium EURe v2 on Gnosis (an ERC-1967 proxy, implementation GnosisControllerToken). The v1 address
 * 0xcB444e90D8198415266c6a2724b7900fb12FC56E forwards to it (its getController() is this address), and both show
 * the same balances. The balances live here, so the page reads and sends here.
 */
export const EURE_TOKEN = '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430';

# Tytle account exit

**Use this only if Tytle no longer exists.** While Tytle exists, use the Tytle app. There, your passkey can send
your money anywhere at once.

**Not technical?** Go to [Get your money out, step by step](#get-your-money-out-step-by-step).

This repository is public and free software (GPL-3.0). Tytle does not run any part of it. It needs no Tytle server,
no Tytle web address and no Tytle staff.

> **Status: draft.** The exit contract is deployed on Gnosis, but the exit page is not published yet. Do not use any
> part of this until this file says it is live. See [Status](#status).

## What this is

A Tytle account is a Safe: a smart-contract wallet on the Gnosis blockchain. It holds your euros as EURe, a euro
token from Monerium. Every day you sign with a passkey. That passkey works only on Tytle's web address.

If Tytle disappears (the company, its servers or its web address), the passkey can no longer sign. This repository
gives you a way out with only your 12 recovery words. It has two parts:

1. **The exit contract.** A second copy of Candide's audited recovery contract (`SocialRecoveryModule` v0.0.1).
   It is the same code with one change: the wait is 90 days, not 14. On this copy your 12 words are the only
   guardian. Tytle is not a guardian. The copy has no owner and no admin, so nobody can change it, Tytle included.
   One copy serves every Tytle account.
2. **The exit page.** One static web page. It runs in your browser and talks only to the Gnosis blockchain, through
   public nodes. You type your 12 words, start the take-over, wait 90 days, finish it, then send your euros to an
   address you choose.

While Tytle exists, your passkey can stop a take-over at any time in the 90 days. So if somebody steals your words
and starts one, you can stop it before it finishes.

## Get your money out, step by step

This part is for everybody. You do not need to know about computers or crypto. Read it all once before you start.

### Use it only if Tytle is gone

Use this page only if Tytle no longer exists. While Tytle exists, use the Tytle app: there, your passkey can send
your money at once, with no wait.

### What you need

- **Your recovery code sheet.** This is the paper with your 12 words. It also shows your account address, the
  address of this page, and the page's IPFS address.
- **A computer or a phone** with an up-to-date web browser, for example Chrome, Firefox, Safari or Edge. A computer
  is easier. Use your own device. Do not use a shared or public computer.
- **0.01 xDAI.** xDAI is the coin that pays the small fees on the Gnosis blockchain. 0.01 xDAI is about 1 cent, and
  it is enough for all the steps. You can buy xDAI in a crypto app, or at an exchange that can send it "on Gnosis".
  Or ask a person who has a crypto wallet to send it for you. Anybody can pay the fee for you. It gives them no
  power over your account.
- **90 days.** After you start, you must wait 90 days. Then you come back to finish. On each of the two days, the
  work takes about 15 minutes (plus the time to get the xDAI).
- **A pen.** You write down one date.

The whole way, in short: open the page, type your 12 words, find your account, pay the fee, tap **Start**. Wait 90
days. Open the page again, type your words again, find your account again, tap **Finish**. Then send your euros.

### Step 1. Open the real page

1. Type the page's address into your browser yourself, exactly as on your code sheet:
   `https://loekj.github.io/tytle-recovery/` (not published yet).
2. Never open the page from a link in an e-mail, a text message or a chat. A fake copy of the page can steal your
   money.
3. Look at the address bar at the top of your browser. It must show the same address as your code sheet, letter
   for letter. The page also shows its own address, under its title. Compare that one too.
4. To change the language, use the list at the top right: English, Português (Portugal), Português (Brasil) or
   Español.

Two other ways to open the same page:

- **A saved copy.** The page is one file. To save it, open the page, then use your browser's "Save page as" (Ctrl+S
  on Windows, Cmd+S on a Mac). If the browser asks for a format, choose "HTML only" or "Page source". Later, open the
  saved file with a double-click. It still needs the internet, to talk to the blockchain. A saved copy cannot use a
  wallet extension (see step 4). The usual way (the wallet made from your words) works.
- **IPFS.** If you use an IPFS app (for example IPFS Desktop), open `ipfs://` followed by the IPFS address on your
  code sheet. The large free IPFS website, ipfs.io, closed in September 2026.

### Step 2. Type your 12 words

- Type one word in each box, in the order on your sheet. You can also paste all 12 words into the first box.
- Tap **Continue**.
- Your words stay on your device. The page does not send them or store them.

The page checks the words. It can say:

- **"Type all 12 words. Missing: word …"**: a box is empty. Fill it.
- **"Not a recovery word: word …"**: check the spelling of that word on your sheet.
- **"These 12 words do not belong together."**: a word is wrong, or two words are in the wrong order. Check each
  word against your sheet.

### Step 3. Find your account

- Type your account address from your code sheet into the box. It starts with `0x`. Then tap **Check this
  account**.
- Or tap **Find my account for me**. The page searches the blockchain and shows how far it is, in %. This can take
  a few minutes.
  - If it finds one account, it shows it.
  - If it finds more than one, it shows each one with its balance. Tap yours.
  - If it finds none, type the account address from your code sheet.
- The page shows your account and its balance in euros.

The page can also say:

- **"There is no account at this address."** or **"This address is not a Tytle account."**: check the address on
  your code sheet.
- **"These words are not the recovery words of this account."**: check the words and the address.
- **"The 90-day exit is not turned on for this account."** or **"This account needs more than these words to
  start."**: this page cannot help with this account.
- **"A take-over of this account was stopped on …"**: an earlier take-over was stopped with the account's passkey.
  You can start again.
- **"The exit contract's code is not the expected code."**: stop. Do not use this page. It may be a fake copy.

If a take-over of your account is already running, the page goes directly to the wait (step 6) or to Finish
(step 7). If you already finished, it goes directly to the send (step 8).

### Step 4. Choose where your money goes

- **Usually, do nothing here.** The page shows the address of a new wallet that your 12 words make. After 90 days,
  your account moves to that wallet. Only your words control it.
- **Your own wallet (only if you know crypto wallets).** Tap **Use my own wallet address instead**, type the address,
  and tap **Use this address**. Then:
  - Use only a normal wallet that you control, with a wallet extension in this browser (for example MetaMask). Not
    an address at an exchange, and not a contract wallet: the page refuses a contract wallet.
  - The page asks your wallet to sign a short message. This shows that the wallet is yours. It costs nothing. If you
    have more than one wallet extension, the page asks you to pick one.
  - Later, the same wallet must sign again, at Finish and at the send. So keep it.
  - A page opened from a saved file cannot use a wallet extension. Open the page from its web address.
  - To go back to the usual choice, tap **Use the wallet made from my words**.

The page refuses an address that cannot be the new owner, and it says why: the zero address, the account itself,
an owner of the account now, a recovery guardian of the account, or an address that the account would refuse. Give
a different address.

### Step 5. Pay the fee, then tap Start

- The page shows a fee address and its QR code. This address is a wallet made from your words. It pays the fees for
  the start, for Finish and for the send.
- Send 0.01 xDAI to that address, on the Gnosis blockchain. The page says about how much this step needs. 0.01 xDAI
  is more than that, and it also pays for the next two steps.
- The page checks the fee balance every 15 seconds. When the fee is there, tap **Start**.
- The page says "Sending. This can take a minute." Then it shows a link, **See the transaction**. You can open it to
  follow the transaction on the Gnosis explorer.
- Then the page shows "Started on …" and "Come back after …". **Write down the "Come back after" date and time.**

The page warns you: while Tytle exists, the account's passkey can stop this take-over during the 90 days.

### Step 6. Wait 90 days

- You can close the page and turn off your device. Nothing more happens until you come back.
- While Tytle exists, the account's passkey can stop the take-over during the 90 days. This protects you if somebody
  steals your words.
- If you keep the page open, it checks again by itself. You can also tap **Check again**.
- If the page says **"The take-over was stopped"**: somebody stopped it with the account's passkey. So Tytle may
  still exist. Use the Tytle app.

### Step 7. Come back and tap Finish

1. After the "Come back after" date, open the page again (step 1).
2. Type your 12 words again (step 2).
3. Find your account again (step 3). The page now shows **5. Finish**.
4. The page shows the fee balance. The 0.01 xDAI from step 5 is usually enough. If the balance is too low, send a
   little more xDAI to the same fee address.
5. If you chose your own wallet in step 4, tap **Sign with my wallet** first.
6. Tap **Finish**.

The page says **"The account is now yours alone."** (or "The account now belongs to your wallet …").

### Step 8. Send your euros

- Type the address that gets your euros. It must be an EURe address on the Gnosis blockchain. EURe is a euro token
  from Monerium: one EURe is one euro.
- To get the euros into your bank account, you need your own Monerium account, or an exchange that accepts EURe on
  Gnosis. It gives you such an address.
- The page always sends all of the euros in the account. It shows the amount.
- Check the address twice. A send cannot be undone.
- Tap **Send**. The page asks: "Send … to …?" Check the amount and the address again. Then tap **Yes, send** (with
  your own wallet: **Sign with my wallet**, then sign in your wallet). Tap **Back** to change the address.
- The page says "Sent. Waiting for the blockchain to confirm it." Then it says **"Sent … to …"**, with a link to the
  transaction.
- When you are done, tap **Clear**, and close the page.

The page refuses an address where euros would be lost, and it says why: the zero address, the account itself, the
EURe token's own address, or a recovery contract. Give a different address.

### After the send

- Your 12 words now control the account. Keep your code sheet safe.
- A little xDAI can stay at the fee address. It belongs to you, through your words.
- To use the wallet made from your words in a standard wallet app: import your 12 words there. Its first account is
  the fee address. Its second account is the account's owner.

### If something goes wrong

- **"Could not read the blockchain."** Check your internet connection, then tap **Try again**.
- **"Two nodes gave different answers."** Wait a minute, then tap **Try again**.
- **"A transaction from this page is still on its way."** Wait a minute, then try again.
- **"Sent, but not confirmed yet."** Open the transaction link. When the explorer shows it as done, tap **Try
  again**. Do not send again before that.
- **"Waiting for the fee."** The fee has not arrived yet. Check that it went to the fee address, on the Gnosis
  blockchain.
- **"This take-over moves the account to … That is not the wallet made from your words."** Somebody else may have
  your words, and they started a take-over to their own wallet. While Tytle exists, open the Tytle app at once and
  stop it with your passkey before the date on the page.
- **"The account's 14-day recovery is also running."** Tytle's own 14-day recovery is running on the account. From
  the date on the page, anybody can finish it, and it replaces the account's owner. Send your euros before that date.
- **"This account is a newer kind."** or **"The account computes a different transaction."** This page cannot
  send from this account. Use the way without this page, below.
- **"No wallet extension was found in this browser."** Install one, or use the wallet made from your words.
- **"Your wallet shows a different address."** In your wallet, pick the address that the page names.
- **"The account holds no euros."** There is nothing to send.

### The way without this page

If the page does not work, a person who knows crypto wallets can do the same steps by hand. The page's help text
says this in short. (This way is not tested from end to end yet.)

1. Import your 12 words into a standard wallet app, for example MetaMask or Rabby. Its first account is the
   guardian: it starts and finishes the take-over, and it pays the fees. Its second account is the new owner. Put a
   little xDAI on the first account.
2. With the first account, open the exit contract on the Gnosis explorer:
   `https://gnosisscan.io/address/0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf?tab=contract`. Connect the wallet, and
   call `confirmRecovery` with `_wallet` = your account address, `_newOwners` = a list with one address, the second
   account's address (for example `[0x…]`), `_newThreshold` = `1`, `_execute` = `true`.
3. After 90 days, call `finalizeRecovery` with `_wallet` = your account address. Anybody may call it.
4. With the second account, open Safe's public app, `https://app.safe.global`, on the Gnosis blockchain. Add your
   account, and send the EURe to your address.

### Advanced: your own node

The page reads the blockchain through public nodes (the box **Connection to the blockchain**). If you run your own
Gnosis node on this device, type its address under **Use my own node (on this device)**, for example
`http://127.0.0.1:8545`, and tap **Use this node**. The page accepts only a node on this device.

### Stay safe

- Never give your 12 words to anybody. Nobody from Tytle will ever ask you for your words.
- Type the page's address yourself. Never use a link from a message.
- Do not use a shared or public computer.
- The page clears your words when you tap **Clear** or when you close the page.

## Check it yourself

You do not have to trust us. You can check each part yourself.

### The exit contract

| What | Value |
|---|---|
| Address on Gnosis | `0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf` |
| Deployed | block 49,062,599 (2 November 2026, 00:10 UTC), transaction `0x4c72845ad71c59d7668e312b316051274f43f8119881a98c85f11868cd55e4ba` |
| Source verified | [Sourcify](https://sourcify.dev/#/lookup/0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf): exact match of the creation code and of the code now; [Blockscout](https://gnosisscan.io/address/0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf?tab=contract): verified |
| Contract | Candide `SocialRecoveryModule` v0.0.1, recovery period `7776000` s (90 days) |
| Made by | CREATE2 through Safe's singleton factory `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` |
| Salt | `keccak256("tytle-recovery/exit-module/v1")` = `0x66c1949da6c15398b05456289daf66d889642a3648c6442b286aa7411e6fc36f` |
| Init code | 13,758 bytes, keccak256 `0x2272571d9b1421497bdb543cedfdad307f3cbd60373ed1a4fc80d7ba20d7006b` |
| Runtime code | 13,606 bytes, keccak256 `0xb06d1b05023177507e6dc187da319f75e1c10beab3f2542851b865263f771bec` |

The address is a pure function of the factory, the salt and the init code. Anybody can compute it, and anybody can
send the same deploy: the result is always the same contract at the same address.

The deployed 14-day copy (`0x9BacD92F4687Db306D7ded5d4513a51EA05df25b` on Gnosis, verified on Blockscout and
Sourcify) was made the same way, through the same factory, with salt 0. Our build reproduces it byte for byte.

### Run the checks

```sh
npm ci --ignore-scripts
npm run check:bytecode   # our 14-day build = the deployed bytes; the 90-day copy differs only in its wait
npm run deploy:print     # the factory, salt, init code hash and address
npm test                 # all tests, on a local chain, with no network
```

`npm run check:bytecode` prints this (the 90-day copy differs in 2 bytes, both inside the 32-byte wait value):

```
MATCH   init code (creation code + 0x127500) = the deploy transaction's input after its salt (13758 bytes)
MATCH   CREATE2(factory 0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7, salt 0x0000000000000000000000000000000000000000000000000000000000000000, our init code) = 0x9BacD92F4687Db306D7ded5d4513a51EA05df25b
MATCH   runtime code = eth_getCode(0x9BacD92F4687Db306D7ded5d4513a51EA05df25b) (13606 bytes, keccak256 0xf80b3e2f6c8149da85c8c40738b9d736f538bbf8f7d386c4318d13bd8f61b02e)

90-day runtime vs 14-day runtime: same length true, 2 byte(s) differ:
  byte 11209: 0x12 -> 0x76
  byte 11210: 0x75 -> 0xa7
MATCH   every differing byte lies in the recoveryPeriod immutable (bytes 11180..11211)
MATCH   the 90-day init code differs from the 14-day one only in its last 32 bytes (the constructor argument)
```

These read the network (public Gnosis nodes, or Sourcify):

```sh
npm run net:check-sources     # contracts/ = the verified source on Sourcify, byte for byte
npm run net:record-fixtures   # read the chain data in fixtures/gnosis/ again, from two nodes
npm run net:deploy-dry-run    # deploy on a local fork of Gnosis, in memory (sends nothing to Gnosis)
npm run net:deploy-check      # the factory is on Gnosis, and the address holds the exit copy's code (sends nothing)
npm run net:verify -- --tx 0x4c72845ad71c59d7668e312b316051274f43f8119881a98c85f11868cd55e4ba
                              # Sourcify compiles contracts/ again and compares it with the code on Gnosis
```

### The exit page

The page is one file, `index.html`, with its script and style inside it. The build is reproducible: the same source
always gives the same bytes. Build it and compare its hash with the hash listed here (listed once it is published),
and with the file you opened:

```sh
npm ci --ignore-scripts
npm run check:reproducible   # builds twice, compares, writes dist/index.html and prints its sha256
```

The licences of the packages inside the page are in a comment at the end of `index.html`, so every copy carries
them. `dist/licenses.txt` holds the same text.

The IPFS copy is `index.html` alone. Its address is a hash of the file, so a copy with other bytes has another
address. CI prints the file's sha256 before it publishes.

## Safety

- Your words never leave your device. The page has no analytics, no error reporting, and no scripts, fonts or images
  from another host. It does not store your words, not even for the session. It clears them when you leave the page
  or tap **Clear**.
- The page talks only to public Gnosis nodes, listed in the page. Before it shows you anything you act on, it asks
  two of them at the same block, and the answers must be equal. If no node answers, it says "could not read": it
  never shows a guessed value, such as a balance of 0.
- You can use your own node instead. It must run on your device (`localhost` or `127.0.0.1`): the page's security
  policy allows no other host.
- If a take-over of your account is already running and its new owner is not the wallet made from your words, the
  page says so plainly. It shows the address and the date, and it does not help to finish that take-over unless
  that wallet proves that it is yours.
- The page's security policy (a `<meta>` Content-Security-Policy): nothing loads from another host; its own script
  and style run only because their sha256 hashes are in the policy; network calls go only to the listed nodes and
  to your own node; no frames, no forms, no images, and no HTML from text (Trusted Types).
- **Fake copies.** A fake page can ask for your words and steal your money. Open only the addresses on your code
  sheet. Compare the IPFS address that the page shows with the one on your code sheet.
- Nobody from Tytle will ever ask you for your words.

## For developers

### Layout

| Folder | What it holds |
|---|---|
| `contracts/` | Candide's verified source, byte for byte as verified on Sourcify, with every licence header |
| `scripts/` | The contract build, the bytecode check, the CREATE2 address, the deploy, the page build, the data recorders |
| `fixtures/` | Public chain data: code read from Gnosis (two nodes, one block), with its keccak256 hash and block number |
| `abi/` | The exit contract's ABI (from our build), and the verified ABIs of Safe 1.4.1 and EURe (from Sourcify) |
| `page/` | The exit page: `index.html` (template), `style.css`, and its code in `page/src/` |
| `test/` | Tests on a local chain (no network), and a test token for the EURe address |

### The exit page's code

| File | What it does |
|---|---|
| `page/src/words.ts` | Checks the 12 words (BIP-39 English list and checksum, says which word is wrong) and makes the two accounts |
| `page/src/chain.ts` | Reads through the nodes; compares two nodes; "could not read" when no node answers |
| `page/src/exit.ts` | Finds and checks the account, refuses a wrong new owner, starts and finishes the take-over |
| `page/src/logs.ts` | Reads the exit contract's records in steps that each node accepts |
| `page/src/send.ts` | Sends the euros, behind one small adapter (see below) |
| `page/src/wallet.ts` | Asks a browser wallet extension for the new owner's signature, when the new owner is the user's own wallet |
| `page/src/ui/` | The screens. Text goes in as text, never as HTML |
| `page/src/i18n/` | English, Portuguese (Portugal), Portuguese (Brazil), Spanish |

**The account.** The user types it from the code sheet. Or the page finds it: it reads the exit contract's
`GuardianAdded` records for the words' first address. Any contract can write such a record, so a find is offered
only when its code is a Safe 1.4.1 proxy's code and it passes every account check; each is shown with its balance.

**The checks before the start.** The exit contract is at its address with its exact code. On the account: the exit
contract is turned on (`isModuleEnabled`), the words' first address is its guardian, the threshold is 1, and no
take-over is running (a running one is shown instead). The new owner is refused when it is a guardian of the exit
contract, a guardian of the 14-day contract, the account itself, the zero address, a current owner, or a contract.
The page also tries, with `eth_call`, the owner change that Finish will make (`swapOwner`, run as the exit contract
through `execTransactionFromModule`): an owner that the account itself would refuse is refused now. The contract
checks only its own guardians, and only at Finish, 90 days later; the page checks all of these before the start.
A user's own wallet must also sign a short message before the start: it shows that the wallet is theirs and can
sign the send later.

**The fee.** Only the words' first address needs xDAI. It sends the start, the finish and the send. The page shows
each transaction's link as soon as it is sent, and it sends nothing while an earlier one is still on its way.

**The send.** The new owner signs a Safe transaction (EIP-712 `SafeTx`): `EURe.transfer(to, whole balance)`. The
words' first address sends it to the account (`execTransaction`) and pays the fee. Before anybody signs, the page
compares its own hash of the transaction with the account's `getTransactionHash`. When the new owner is the user's
own wallet, the page holds no key for it: it asks the user's wallet to sign, through a wallet extension in the
browser (EIP-1193; with several extensions, EIP-6963 lets the user pick one). Signatures that a wallet gives in
another form (`v` = 0 or 1, or 64 bytes) are put in the form Safe reads. The send counts as done only when the
account ran it and the token's own `Transfer` record shows the whole amount going to that address. The fallback, in
the page's help: the exit contract's `confirmRecovery` and `finalizeRecovery` on the explorer, then the send in
Safe's public app (see [The way without this page](#the-way-without-this-page)).

**A later account kind.** The send sits behind one adapter (`SendPath` in `page/src/send.ts`). Today it knows one
path: a Safe 1.4.1 with no transaction guard, where the transfer runs at once. A later account kind may queue a send
first and run it a day later. The adapter's results already have a "queued" kind for that. Until that path exists,
the page reads the account's `VERSION()` and guard, and for any other kind it says plainly that it cannot send yet.

**EURe.** The page uses Monerium's EURe v2 contract on Gnosis, `0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430`. The v1
address `0xcB444e90D8198415266c6a2724b7900fb12FC56E` forwards to it (its `getController()` is the v2 address), and
both show the same balances. The balances live in v2.

### Tools, and why

- **The contract build uses no framework.** A script gives the verified standard-JSON compiler input (from Sourcify)
  to solc 0.8.20 as it is. The input's source names and settings go into the contract's metadata hash, and that hash
  is part of the bytecode. A framework's own build names the sources its own way, so its bytes could not match.
- **Hardhat runs the local test chain** and the fork of Gnosis for the dry run. We picked it over Foundry because it
  installs from npm: every tool is pinned in `package-lock.json`, installed with `npm ci --ignore-scripts`, and
  checked with `npm audit signatures`, the same as the page's own code. And one language (TypeScript) serves the
  page, its checks and the tests, so the tests run the page's own code.
- **The page** uses viem (chain calls, keys from the words), `@scure/bip39` (the word check; viem already uses it)
  and `uqr` (the QR code). No framework. **esbuild** bundles it into one file; it is deterministic, so two builds
  are the same. **happy-dom** runs the page's screens in the tests; it never reaches the page.
- `npm audit` reports one advisory for `zod` (memory use when it validates very large input). Only the developer
  tools use zod (Hardhat's config check). It is not inside the page: the page test lists every package in it.

### Build and test

See [Run the checks](#run-the-checks). Node.js 24 or later. CI (`.github/workflows/ci.yml`) installs with
`npm ci --ignore-scripts`, runs `npm audit signatures`, the type check and the tests, builds the page twice and
compares the two builds, and prints the page's hash.

```sh
npm run build:page            # dist/index.html: open it in a browser
npm run net:record-abis       # read the verified ABIs in abi/ again, from Sourcify
npm run net:page-fork-check   # the whole exit through the page's code on a local fork of Gnosis, with real EURe
```

The tests run the page's screens in happy-dom (a test browser), and the built page once in headless Chrome, when
Chrome is found, so the security policy is on.

### Publishing (for maintainers)

A push never publishes. The page goes live only when a maintainer presses a button:

1. Put the change on `main`. CI runs every check on each push, but it publishes nothing.
2. On GitHub, open this repository, then click **Actions**.
3. In the list on the left, click **Publish**.
4. Click **Run workflow**. Keep the branch `main`. Click the green **Run workflow** button.
5. Wait until the run is green. It has three jobs: `test` (every check of CI), `pages` and `ipfs`.
6. Open the run. Its summary shows the page's IPFS address (CID) and its sha256. Write both into this README.

If a job fails, open it and read its last lines. To try again, click **Re-run failed jobs**. This is safe: the same
page always gets the same IPFS address.

The Publish workflow (`.github/workflows/publish.yml`) publishes the page that CI's checks built and tested, twice:

- **GitHub Pages**, with GitHub's own Pages actions.
- **IPFS**, uploaded to Pinata by `scripts/publish-ipfs.ts` (Pinata's v3 upload; the key needs only the permission
  Files: Write). This job installs no npm package (the script uses only Node's own modules), and only this job gets
  the token, from the repository secret `PINATA_JWT`. After the upload, it reads the page back by its address and
  compares it byte for byte. The same bytes give the same address, so a new run is safe. A change to this README
  does not change the address; a change to the page does.

```sh
PINATA_JWT=... node scripts/publish-ipfs.ts dist/index.html   # by hand; the token comes only from the environment
```

### The deploy

`scripts/deploy-exit-module.ts` sends nothing unless it gets `--send`, a node (`--rpc`), the key in the
`DEPLOYER_PRIVATE_KEY` environment variable, and `--confirm` with the printed address typed again. Before it sends,
it checks that the node is Gnosis, that the factory holds the factory's code, that the address is empty, and that a
dry call returns the predicted address. After it sends, it checks the new code byte for byte.

## Status

| Part | State |
|---|---|
| Repository skeleton, this README | draft |
| Bytecode match of the 14-day copy | done: byte for byte |
| 90-day copy and its CREATE2 address | done: `0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf` |
| Dry run on a local fork of Gnosis | done |
| Deploy on Gnosis | done: block 49,062,599; verified on Sourcify (exact match) and Blockscout |
| Exit page | built, with its tests; not published |
| Tests | 89 tests on a local chain: the contract, the deploy, the page from the words to the send, the hard cases, and the IPFS publish |
| Fork check with real EURe | done: the whole balance moved, on a local fork of Gnosis |
| The way without this page | written (page help and this README); not tested from end to end on Gnosis |
| GitHub Pages and IPFS | CI workflow ready; not published |

## Licence

GPL-3.0 (see `LICENSE`). Our own code is GPL-3.0-only. The files in `contracts/` keep their own headers: Candide's
recovery module is GPL-3.0, Candide's and Safe's interface files are LGPL-3.0-only, and the OpenZeppelin files are
MIT.

This software comes with no warranty. Read `LICENSE`.

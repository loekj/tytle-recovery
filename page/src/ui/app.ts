// SPDX-License-Identifier: GPL-3.0-only
//
// The exit page's screens: words, account, start, waiting, finish, send.
// The page holds everything in memory only. "Clear", and leaving the page,
// drop the words and the keys made from them.

import { isAddressEqual, type Address, type EIP1193Provider, type HDAccount, type Hex } from 'viem';
import { RECOVERY_PERIOD_90_DAYS } from '../../../scripts/lib/addresses.ts';
import { Chain, CouldNotRead, NodesDisagree, ownNodeUrl } from '../chain.ts';
import { EXIT_MODULE, EXIT_MODULE_SEARCH_FROM_BLOCK, EXPLORER, OWN_NODE_HOSTS, SAFE_APP } from '../config.ts';
import {
  PageRefusal,
  TxStillPending,
  accountProblems,
  canFinish,
  feeFor,
  findAccounts,
  finishTakeOver,
  newOwnerRefusals,
  parseAddress,
  readAccount,
  readExitCopyPresent,
  readLastTakeOverEvent,
  readNewOwnerFacts,
  readSearchCandidates,
  readXdaiBalance,
  startGas,
  startTakeOver,
  type AccountFacts,
  type TakeOverEvent,
} from '../exit.ts';
import { formatDateTime, formatEuro, formatXdai, isBelowOneCent } from '../format.ts';
import { INTL_LOCALE, LOCALES, pickLocale, text, type Locale, type MessageKey } from '../i18n/index.ts';
import type { ScanOptions } from '../logs.ts';
import { chooseSendPath, signWithKey, type PreparedSend, type SendPath } from '../send.ts';
import { WalletProblem, proveControl, signWithWallet, type WalletChoice } from '../wallet.ts';
import { checkWords, deriveAccounts, splitWords, WORD_COUNT, type WordAccounts } from '../words.ts';
import { h, link, type Child } from './dom.ts';
import { qrSvg } from './qr.ts';

export interface AppEnv {
  /** The chain for a list of node URLs (public ones, or the user's own). */
  chainFor(urls: readonly string[]): Chain;
  publicNodes: readonly string[];
  /** Where this page was opened from, shown so the user can compare it with the code sheet. */
  pageAddress: string;
  languages: readonly string[];
  /** The browser's wallet extensions (EIP-6963, or window.ethereum). */
  wallets(): Promise<WalletChoice[]>;
  pollMs: { fee: number; waiting: number };
  /** For tests: where the record search starts. */
  scan?: Partial<ScanOptions>;
  source: string;
}

type Screen = 'words' | 'account' | 'start' | 'waiting' | 'finish' | 'send';

/**
 * Who becomes the owner. 'words': the words' second address (the page holds its key). 'own': another wallet;
 * `proven` once that wallet signed the proof message in this visit.
 */
type NewOwner = { kind: 'words' } | { kind: 'own'; address: Address; proven: boolean };

interface State {
  locale: Locale;
  ownNode: string | null;
  chain: Chain;
  screen: Screen;
  /** What is typed in the 12 boxes; emptied as soon as the keys are made. */
  typed: string[];
  keys: WordAccounts | null;
  accountText: string;
  facts: AccountFacts | null;
  newOwner: NewOwner;
  /** A message shown when a screen opens (for example after Clear). */
  notice: string | null;
  /** A transaction link shown when a screen opens (the step that led there). */
  lastTx: string | null;
  /** Changes on every screen change and on Clear: late answers for an old screen are dropped. */
  gen: number;
  timers: ReturnType<typeof setTimeout>[];
}

export interface MountedApp {
  clear(): void;
}

export function mountApp(root: HTMLElement, env: AppEnv): MountedApp {
  const doc = root.ownerDocument;
  const state: State = {
    locale: pickLocale(env.languages),
    ownNode: null,
    chain: env.chainFor(env.publicNodes),
    screen: 'words',
    typed: Array<string>(WORD_COUNT).fill(''),
    keys: null,
    accountText: '',
    facts: null,
    newOwner: { kind: 'words' },
    notice: null,
    lastTx: null,
    gen: 0,
    timers: [],
  };

  const t = (key: MessageKey, values?: Record<string, string>) => text(state.locale, key, values);
  const intl = () => INTL_LOCALE[state.locale];
  const euro = (amount: bigint) => (isBelowOneCent(amount) ? t('belowOneCent', { amount: formatEuro(10n ** 16n, intl()) }) : formatEuro(amount, intl()));
  const date = (unixSeconds: bigint) => formatDateTime(unixSeconds, intl());
  const newOwnerAddress = (): Address | null => (state.newOwner.kind === 'own' ? state.newOwner.address : (state.keys?.newOwner.address ?? null));
  /** The owner a take-over names, as the page's choice: the words' wallet, or another wallet not proven yet. */
  const ownerChoice = (owner: Address): NewOwner =>
    state.keys && isAddressEqual(owner, state.keys.newOwner.address)
      ? { kind: 'words' }
      : { kind: 'own', address: owner, proven: state.newOwner.kind === 'own' && state.newOwner.proven && isAddressEqual(state.newOwner.address, owner) };

  function stopTimers(): void {
    for (const id of state.timers) clearTimeout(id);
    state.timers = [];
  }

  function show(screen: Screen): void {
    stopTimers();
    state.gen += 1;
    state.screen = screen;
    render();
  }

  function clear(): void {
    stopTimers();
    state.gen += 1;
    state.typed = Array<string>(WORD_COUNT).fill('');
    state.keys = null;
    state.accountText = '';
    state.facts = null;
    state.newOwner = { kind: 'words' };
    state.screen = 'words';
    state.notice = t('cleared');
    render();
  }

  /** The words: from the boxes into the state, so a re-render (a language change) keeps them. */
  function keepTyped(): void {
    root.querySelectorAll<HTMLInputElement>('input[data-word]').forEach((input) => {
      state.typed[Number(input.dataset.word)] = input.value;
    });
  }

  function describe(err: unknown): string {
    if (err instanceof CouldNotRead) return t('couldNotRead');
    if (err instanceof NodesDisagree) return t('nodesDisagree');
    if (err instanceof TxStillPending) return t('stillPending');
    if (err instanceof WalletProblem) {
      if (err.reason === 'no-wallet') return t('walletNone');
      if (err.reason === 'other-address') return t('walletOther', { address: newOwnerAddress() ?? '' });
      return t('walletRefused');
    }
    if (err instanceof PageRefusal) return err.reasons.map(refusalText).join(' ');
    const e = err as { shortMessage?: string; message?: string };
    const detail = (e.shortMessage ?? e.message ?? String(err)).split('\n')[0]!.slice(0, 200);
    return t('failed', { detail });
  }

  const REFUSAL_TEXT: Record<string, MessageKey> = {
    'not-a-contract': 'problem_not_a_contract',
    'not-a-safe': 'problem_not_a_safe',
    'exit-copy-off': 'problem_exit_copy_off',
    'not-guardian': 'problem_not_guardian',
    'threshold-not-one': 'problem_threshold_not_one',
    'zero-address': 'refusal_zero_address',
    'the-account': 'refusal_the_account',
    'current-owner': 'refusal_current_owner',
    'guardian-exit-copy': 'refusal_guardian_exit_copy',
    'guardian-14-day-copy': 'refusal_guardian_14_day_copy',
    'contract-wallet': 'refusal_contract_wallet',
    'owner-refused': 'refusal_owner_refused',
    'too-early': 'refusal_too_early',
    'no-take-over': 'refusal_no_take_over',
    'hash-differs': 'refusal_hash_differs',
    'signer-not-owner': 'refusal_signer_not_owner',
    'take-over-not-finished': 'refusal_take_over_not_finished',
    'transaction-pending': 'refusal_transaction_pending',
    'exit-copy-code-differs': 'exitCodeDiffers',
    'nothing-to-send': 'nothingToSend',
  };

  function refusalText(reason: string): string {
    const key = REFUSAL_TEXT[reason];
    return key ? t(key) : t('failed', { detail: reason });
  }

  function destText(reason: string): string {
    const key = ({ 'zero-address': 'dest_zero_address', 'the-account': 'dest_the_account', 'the-token': 'dest_the_token', 'a-recovery-copy': 'dest_a_recovery_copy' } as Record<string, MessageKey>)[reason];
    return key ? t(key) : refusalText(reason);
  }

  interface RunOptions {
    onError?: (err: unknown) => string;
    /** Offer "Try again" after a failure. */
    retry?: () => void;
  }

  /**
   * Run one async step for the current screen: buttons off, status cleared, and the answer dropped if the user
   * has moved on (or cleared) in the meantime. A failure says what went wrong, with the transaction's link when one
   * was sent, and "Try again" when the step can be repeated.
   */
  function run(status: HTMLElement, buttons: HTMLButtonElement[], task: (alive: () => boolean) => Promise<void>, options: RunOptions = {}): void {
    const gen = state.gen;
    const alive = () => gen === state.gen;
    for (const b of buttons) b.disabled = true;
    status.replaceChildren();
    status.classList.remove('error');
    void task(alive)
      .catch((err: unknown) => {
        if (!alive()) return;
        const parts: Child[] = [options.onError ? options.onError(err) : describe(err)];
        if (err instanceof TxStillPending) parts.push(' ', txLink(err.transactionHash));
        if (options.retry) parts.push(' ', button(t('tryAgain'), 'try-again', options.retry, false));
        status.replaceChildren(...parts.filter((p): p is Node | string => !!p));
        status.classList.add('error');
      })
      .finally(() => {
        if (alive()) for (const b of buttons) b.disabled = false;
      });
  }

  function later(fn: () => void, ms: number): void {
    state.timers.push(setTimeout(fn, ms));
  }

  const statusLine = () => h(doc, 'p', { class: 'status', role: 'status', attrs: { 'aria-live': 'polite' } });
  const button = (label: string, role: string, onClick: () => void, primary = true) =>
    h(doc, 'button', { class: primary ? 'primary' : 'secondary', role, attrs: { type: 'button' }, on: { click: onClick } }, label);
  const txLink = (hash: string) => link(doc, `${EXPLORER}/tx/${hash}`, t('seeTransaction'));
  const addressLine = (label: string, address: string, role?: string) =>
    h(doc, 'p', { class: 'address-line' }, h(doc, 'span', { class: 'label' }, label), ' ', h(doc, 'code', { role: role ?? '' }, address));
  /** "Sent, waiting for it", with the link, as soon as a transaction is out. */
  const sentLine = (status: HTMLElement) => (hash: Hex) => {
    status.classList.remove('error');
    status.replaceChildren(t('sentWaiting'), ' ', txLink(hash));
  };
  /** The 14-day copy's live recovery, if any: it can replace the owner once it is due. */
  const otherRecovery = (f: AccountFacts) =>
    f.request14Day ? h(doc, 'p', { class: 'notice', role: 'other-recovery' }, t('otherRecovery', { date: date(f.request14Day.executeAfter) })) : null;

  /** One wallet extension: the only one, or the one the user picks. */
  async function chooseWallet(container: HTMLElement): Promise<EIP1193Provider> {
    const wallets = await env.wallets();
    if (wallets.length === 0) throw new WalletProblem('no-wallet');
    if (wallets.length === 1) return wallets[0]!.provider;
    return new Promise((resolve) => {
      container.replaceChildren(
        h(doc, 'p', {}, t('walletPick')),
        ...wallets.map((w) =>
          button(w.name, 'wallet-choice', () => {
            container.replaceChildren();
            resolve(w.provider);
          }, false),
        ),
      );
    });
  }

  // ---- The frame: title, warnings, language, Clear, nodes, help ----

  function render(): void {
    root.replaceChildren(header(), screenView(), nodesBox(), helpBox());
    doc.documentElement.lang = state.locale;
    doc.title = t('title');
  }

  function header(): HTMLElement {
    const select = h(doc, 'select', { role: 'lang', attrs: { 'aria-label': t('language') } });
    for (const l of Object.keys(LOCALES) as Locale[]) {
      const opt = h(doc, 'option', { attrs: { value: l } }, LOCALES[l].langName);
      if (l === state.locale) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      keepTyped();
      state.locale = select.value as Locale;
      render();
    });
    return h(
      doc,
      'header',
      {},
      h(doc, 'div', { class: 'top' }, h(doc, 'h1', {}, t('title')), h(doc, 'div', { class: 'top-actions' }, select, button(t('clear'), 'clear', clear, false))),
      h(doc, 'p', { class: 'warning' }, t('onlyIfGone')),
      h(doc, 'p', { class: 'page-address' }, `${t('pageAddress')} `, h(doc, 'code', { role: 'page-address' }, env.pageAddress), ' ', t('pageAddressCheck')),
    );
  }

  function nodesBox(): HTMLElement {
    const status = statusLine();
    const input = h(doc, 'input', { role: 'own-node-input', attrs: { type: 'url', placeholder: 'http://127.0.0.1:8545', autocomplete: 'off', spellcheck: 'false' } });
    const list = h(doc, 'ul', {}, ...(state.ownNode ? [state.ownNode] : env.publicNodes).map((u) => h(doc, 'li', {}, h(doc, 'code', {}, u))));
    const use = button(
      t('ownNodeUse'),
      'own-node-use',
      () => {
        const url = ownNodeUrl(input.value, OWN_NODE_HOSTS);
        if (!url) {
          status.textContent = t('ownNodeBad');
          status.classList.add('error');
          return;
        }
        state.ownNode = url;
        state.chain = env.chainFor([url]);
        keepTyped();
        render();
      },
      false,
    );
    const back = state.ownNode
      ? button(
          t('publicNodesAgain'),
          'public-nodes',
          () => {
            state.ownNode = null;
            state.chain = env.chainFor(env.publicNodes);
            keepTyped();
            render();
          },
          false,
        )
      : null;
    const details = h(
      doc,
      'details',
      { class: 'box' },
      h(doc, 'summary', {}, t('nodesTitle')),
      h(doc, 'p', {}, state.ownNode ? t('ownNodeInUse', { url: state.ownNode }) : t('nodesText')),
      list,
      h(doc, 'label', {}, t('ownNodeLabel'), input),
      h(doc, 'div', { class: 'actions' }, use, back),
      status,
    );
    if (state.ownNode) details.open = true;
    return details;
  }

  function helpBox(): HTMLElement {
    return h(
      doc,
      'details',
      { class: 'box' },
      h(doc, 'summary', {}, t('helpTitle')),
      ...(['help1', 'help2', 'help3', 'help6', 'help4', 'help5'] as const).map((k) => h(doc, 'p', {}, t(k, { safeApp: SAFE_APP, exitContract: `${EXPLORER}/address/${EXIT_MODULE}?tab=contract`, source: env.source }))),
    );
  }

  function section(title: string, ...children: Child[]): HTMLElement {
    const notice = state.notice ? h(doc, 'p', { class: 'notice', role: 'notice' }, state.notice) : null;
    const tx = state.lastTx ? h(doc, 'p', { role: 'last-tx' }, txLink(state.lastTx)) : null;
    state.notice = null;
    state.lastTx = null;
    return h(doc, 'section', { class: 'screen', role: `screen-${state.screen}` }, h(doc, 'h2', {}, title), notice, tx, ...children);
  }

  function screenView(): HTMLElement {
    switch (state.screen) {
      case 'words':
        return wordsScreen();
      case 'account':
        return accountScreen();
      case 'start':
        return startScreen();
      case 'waiting':
        return waitingScreen();
      case 'finish':
        return finishScreen();
      case 'send':
        return sendScreen();
    }
  }

  /** Where a known account goes next, from what the chain says now. */
  function route(f: AccountFacts): boolean {
    const keys = state.keys as WordAccounts;
    state.facts = f;
    if (f.request) {
      state.newOwner = ownerChoice(f.request.newOwners[0]!);
      show(canFinish(f) ? 'finish' : 'waiting');
      return true;
    }
    if (f.owners.length === 1 && isAddressEqual(f.owners[0]!, keys.newOwner.address)) {
      state.newOwner = { kind: 'words' };
      show('send');
      return true;
    }
    return false;
  }

  // ---- 1. The 12 words ----

  function wordsScreen(): HTMLElement {
    const status = statusLine();
    const boxes: HTMLInputElement[] = [];
    /** Several words in one box (a paste, or a keyboard's clipboard that types them in): one word per box. */
    const spread = (i: number, text: string): boolean => {
      const words = splitWords(text);
      if (words.length < 2) return false;
      words.slice(0, WORD_COUNT - i).forEach((w, k) => {
        const target = boxes[i + k];
        if (target) target.value = w;
      });
      return true;
    };
    const labels = state.typed.map((value, i) => {
      const input = h(doc, 'input', {
        attrs: {
          type: 'text',
          autocomplete: 'off',
          autocapitalize: 'none',
          autocorrect: 'off',
          spellcheck: 'false',
          'aria-label': t('wordLabel', { n: String(i + 1) }),
          'data-word': String(i),
        },
      });
      input.value = value;
      boxes.push(input);
      input.addEventListener('paste', (event) => {
        if (spread(i, (event as ClipboardEvent).clipboardData?.getData('text') ?? '')) event.preventDefault();
      });
      input.addEventListener('input', () => {
        if (/\s/u.test(input.value.trim())) spread(i, input.value);
      });
      return h(doc, 'label', { class: 'word' }, h(doc, 'span', { class: 'n' }, String(i + 1)), input);
    });
    const go = button(t('continue'), 'continue', () => {
      keepTyped();
      const check = checkWords(state.typed);
      if (check.kind !== 'ok') {
        status.textContent =
          check.kind === 'missing'
            ? t('wordsMissing', { list: check.positions.join(', ') })
            : check.kind === 'not-on-list'
              ? t('wordsNotOnList', { list: check.positions.join(', ') })
              : t('wordsDoNotFit');
        status.classList.add('error');
        for (const [i, box] of boxes.entries()) {
          const bad = check.kind !== 'do-not-fit' && check.positions.includes(i + 1);
          box.setAttribute('aria-invalid', bad ? 'true' : 'false');
        }
        return;
      }
      state.keys = deriveAccounts(state.typed);
      state.typed = Array<string>(WORD_COUNT).fill('');
      show('account');
    });
    return section(
      t('wordsTitle'),
      h(doc, 'p', { class: 'reassure' }, t('wordsStay')),
      h(doc, 'p', { class: 'hint' }, t('wordsPasteHint')),
      h(doc, 'div', { class: 'words' }, ...labels),
      h(doc, 'div', { class: 'actions' }, go),
      status,
    );
  }

  // ---- 2. The account ----

  function accountScreen(): HTMLElement {
    const keys = state.keys as WordAccounts;
    const status = statusLine();
    const progress = h(doc, 'p', { class: 'hint', role: 'progress' });
    const result = h(doc, 'div', { role: 'account-result' });
    const input = h(doc, 'input', { role: 'account-input', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '0x...' } });
    input.value = state.accountText;
    const check = button(t('checkAccount'), 'check-account', () => {
      state.accountText = input.value;
      const account = parseAddress(input.value);
      if (!account) {
        status.textContent = t('addressBad');
        status.classList.add('error');
        return;
      }
      checkAccount(account);
    });
    const find = button(t('findForMe'), 'find', () => search(), false);

    function search(): void {
      run(
        status,
        [check, find],
        async (alive) => {
          result.replaceChildren();
          if (!(await exitCopyReady(status))) return;
          const found = await findAccounts(state.chain, keys.guardian.address, {
            ...env.scan,
            onProgress: (done, to) => {
              if (!alive()) return;
              const from = env.scan?.fromBlock ?? EXIT_MODULE_SEARCH_FROM_BLOCK;
              const span = to - from;
              progress.textContent = t('searching', { percent: String(span > 0n ? Number(((done - from) * 100n) / span) : 100) });
            },
          });
          // Any contract can write a record that names these words; only real accounts count.
          const candidates = await readSearchCandidates(state.chain, found, keys.guardian.address);
          if (!alive()) return;
          progress.textContent = '';
          if (candidates.length === 0) {
            status.textContent = t('foundNone');
            return;
          }
          if (candidates.length === 1) {
            input.value = candidates[0]!.account;
            state.accountText = candidates[0]!.account;
            checkAccount(candidates[0]!.account);
            return;
          }
          result.replaceChildren(
            h(doc, 'p', {}, t('foundMany')),
            ...candidates.map((f) =>
              button(`${f.account}: ${euro(f.eureBalance)}`, 'found-account', () => {
                input.value = f.account;
                state.accountText = f.account;
                checkAccount(f.account);
              }, false),
            ),
          );
        },
        { retry: search },
      );
    }

    function checkAccount(account: Address): void {
      run(
        status,
        [check, find],
        async (alive) => {
          result.replaceChildren();
          if (!(await exitCopyReady(status))) return;
          const facts = await readAccount(state.chain, account, keys.guardian.address);
          if (!alive()) return;
          const problems = accountProblems(facts);
          if (problems.length > 0) {
            status.textContent = problems.map(refusalText).join(' ');
            status.classList.add('error');
            return;
          }
          if (route(facts)) return;
          // Not taken over by the words' wallet, and no take-over running. Was it taken over to the user's own
          // wallet earlier? Only the account's records can say: so this read is needed, and a failure is shown.
          const last = await readLastTakeOverEvent(state.chain, account, env.scan);
          if (!alive()) return;
          if (last?.kind === 'finished' && facts.owners.length === 1) {
            state.facts = facts;
            state.newOwner = ownerChoice(facts.owners[0]!);
            show('send');
            return;
          }
          state.facts = facts;
          result.replaceChildren(accountSummary(facts, last), newOwnerChooser(facts));
        },
        { retry: () => checkAccount(account) },
      );
    }

    return section(
      t('accountTitle'),
      h(doc, 'label', {}, t('accountLabel'), input),
      h(doc, 'div', { class: 'actions' }, check, find),
      progress,
      status,
      result,
    );
  }

  /** The exit copy must be on the chain with its exact code. */
  async function exitCopyReady(status: HTMLElement): Promise<boolean> {
    if (await readExitCopyPresent(state.chain)) return true;
    status.textContent = t('notDeployed');
    status.classList.add('error');
    return false;
  }

  function accountSummary(facts: AccountFacts, last: TakeOverEvent | null): HTMLElement {
    return h(
      doc,
      'div',
      { class: 'summary' },
      addressLine(t('account'), facts.account, 'account'),
      h(doc, 'p', { class: 'balance' }, h(doc, 'span', { class: 'label' }, t('balance')), ' ', h(doc, 'strong', { role: 'balance' }, euro(facts.eureBalance))),
      last?.kind === 'stopped' ? h(doc, 'p', { class: 'notice', role: 'last-event' }, t('lastStopped', { date: date(last.time) })) : null,
      otherRecovery(facts),
    );
  }

  function newOwnerChooser(facts: AccountFacts): HTMLElement {
    const keys = state.keys as WordAccounts;
    const status = statusLine();
    const box = h(doc, 'div', { class: 'new-owner' });

    /** The page's rules for the new owner, on fresh reads. */
    async function refused(candidate: Address): Promise<boolean> {
      const refusals = newOwnerRefusals(facts, await readNewOwnerFacts(state.chain, facts, candidate));
      if (refusals.length === 0) return false;
      status.textContent = refusals.map(refusalText).join(' ');
      status.classList.add('error');
      return true;
    }

    const go = button(t('continue'), 'account-continue', () =>
      run(status, [go], async (alive) => {
        if ((await refused(keys.newOwner.address)) || !alive()) return;
        state.newOwner = { kind: 'words' };
        show('start');
      }),
    );

    function draw(): void {
      box.replaceChildren(
        h(doc, 'p', {}, t('movesTo')),
        h(doc, 'p', {}, h(doc, 'code', { role: 'new-owner' }, keys.newOwner.address)),
        h(doc, 'div', { class: 'actions' }, go, button(t('useOwnWallet'), 'use-own-wallet', drawOwn, false)),
      );
    }

    function drawOwn(): void {
      const input = h(doc, 'input', { role: 'own-wallet-input', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '0x...' } });
      const picker = h(doc, 'div', { role: 'wallet-picker' });
      const use = button(t('ownWalletUse'), 'own-wallet-use', () => {
        const address = parseAddress(input.value);
        if (!address) {
          status.textContent = t('addressBad');
          status.classList.add('error');
          return;
        }
        run(status, [use], async (alive) => {
          if ((await refused(address)) || !alive()) return;
          // The wallet proves it is the user's, and that it can sign: before 90 days are spent on it.
          state.newOwner = { kind: 'own', address, proven: false };
          status.textContent = t('proveText');
          await proveControl(await chooseWallet(picker), address, facts.account);
          if (!alive()) return;
          state.newOwner = { kind: 'own', address, proven: true };
          state.notice = t('proveDone');
          show('start');
        });
      });
      box.replaceChildren(
        h(doc, 'p', {}, t('movesToOwn')),
        h(doc, 'label', {}, t('ownWalletLabel'), input),
        h(doc, 'p', { class: 'hint' }, t('ownWalletNote')),
        h(doc, 'p', { class: 'hint' }, t('proveText')),
        h(doc, 'div', { class: 'actions' }, use, button(t('useWordsWallet'), 'use-words-wallet', draw, false)),
        picker,
      );
    }

    state.newOwner = { kind: 'words' };
    draw();
    return h(doc, 'div', {}, box, status);
  }

  // ---- 3. Start ----

  function feeBox(guardian: HDAccount, onBalance?: (balance: bigint) => void): HTMLElement {
    const balance = h(doc, 'p', { role: 'fee-balance' });
    const gen = state.gen;
    const refresh = async () => {
      try {
        const wei = await readXdaiBalance(state.chain, guardian.address);
        if (gen !== state.gen) return;
        balance.textContent = t('feeBalance', { amount: formatXdai(wei, intl()) });
        balance.classList.remove('error');
        onBalance?.(wei);
      } catch (err) {
        if (gen !== state.gen) return;
        balance.textContent = describe(err);
        balance.classList.add('error');
      }
      if (gen === state.gen) later(() => void refresh(), env.pollMs.fee);
    };
    void refresh();
    return h(
      doc,
      'div',
      { class: 'fee' },
      h(doc, 'p', {}, t('feeAddress')),
      h(doc, 'p', {}, h(doc, 'code', { role: 'fee-address' }, guardian.address)),
      qrSvg(doc, guardian.address, guardian.address),
      balance,
    );
  }

  function startScreen(): HTMLElement {
    const keys = state.keys as WordAccounts;
    const facts = state.facts as AccountFacts;
    const owner = newOwnerAddress() as Address;
    const status = statusLine();
    const needed = h(doc, 'p', { class: 'hint', role: 'fee-needed' });
    let neededWei: bigint | null = null;
    let starting = false;

    /** After a start whose answer was lost: read the account and go where it says. */
    function recheck(): void {
      run(status, [start], async (alive) => {
        const f = await readAccount(state.chain, facts.account, keys.guardian.address);
        if (!alive() || route(f)) return;
        status.textContent = t('stillPending');
      }, { retry: recheck });
    }

    const start = button(t('startButton'), 'start', () =>
      run(
        status,
        [start],
        async (alive) => {
          starting = true;
          try {
            status.textContent = t('sending');
            const sent = await startTakeOver(state.chain, keys.guardian, facts.account, owner, { onSent: sentLine(status) });
            if (!alive()) return;
            state.facts = await readAccount(state.chain, facts.account, keys.guardian.address, sent.blockNumber);
            state.lastTx = sent.transactionHash;
            show('waiting');
          } catch (err) {
            // Started already (an earlier tap went through): show the take-over, not an error.
            if (err instanceof PageRefusal && err.reasons.includes('already-started')) {
              const f = await readAccount(state.chain, facts.account, keys.guardian.address);
              if (alive() && route(f)) return;
            }
            throw err;
          } finally {
            starting = false;
          }
        },
        { retry: recheck },
      ),
    );
    start.disabled = true;
    void feeFor(state.chain, startGas(facts.account, owner, keys.guardian.address))
      .then((wei) => {
        neededWei = wei;
        needed.textContent = t('feeNeeded', { fee: formatXdai(wei, intl()) });
      })
      .catch(() => {
        // The estimate is a help; the balance check below still runs.
      });
    const fee = feeBox(keys.guardian, (wei) => {
      if (starting) return;
      const short = wei === 0n || (neededWei !== null && wei < neededWei);
      start.disabled = short;
      if (short) status.textContent = t('feeWaiting');
      else if (status.textContent === t('feeWaiting')) status.textContent = '';
    });
    return section(
      t('startTitle'),
      addressLine(t('account'), facts.account),
      h(doc, 'p', {}, t(state.newOwner.kind === 'words' ? 'movesTo' : 'movesToOwn'), ' ', h(doc, 'code', {}, owner)),
      h(doc, 'p', {}, t('feeText')),
      fee,
      needed,
      h(doc, 'p', { class: 'hint' }, t('startWarn')),
      h(doc, 'div', { class: 'actions' }, start),
      status,
    );
  }

  // ---- 4. Waiting ----

  function waitingScreen(): HTMLElement {
    const facts = state.facts as AccountFacts;
    const status = statusLine();
    const body = h(doc, 'div', { role: 'waiting' });

    function draw(f: AccountFacts): void {
      if (!f.request) return;
      const owner = f.request.newOwners[0]!;
      const parts: Child[] = [
        h(doc, 'p', { role: 'started-on' }, t('startedOn', { date: date(f.request.executeAfter - RECOVERY_PERIOD_90_DAYS) })),
        h(doc, 'p', { role: 'come-back' }, t('comeBack', { date: date(f.request.executeAfter) })),
        state.newOwner.kind === 'own' && !state.newOwner.proven
          ? h(doc, 'p', { class: 'notice', role: 'other-owner' }, t('otherOwnerWarn', { address: owner, date: date(f.request.executeAfter) }))
          : null,
        otherRecovery(f),
      ];
      body.replaceChildren(...parts.filter((p): p is Node => !!p));
    }

    let stopped = false;
    const again = button(t('checkAgain'), 'check-again', () => check(), false);

    function check(): void {
      run(status, [again], async (alive) => {
        try {
          const before = state.facts as AccountFacts;
          const f = await readAccount(state.chain, before.account, (state.keys as WordAccounts).guardian.address);
          if (!alive()) return;
          state.facts = f;
          if (!f.request) {
            const was = before.request?.newOwners ?? [];
            const finished = f.owners.length === was.length && was.every((o, i) => isAddressEqual(o, f.owners[i]!));
            if (finished) show('send');
            else {
              stopped = true;
              body.replaceChildren(h(doc, 'p', { class: 'notice', role: 'stopped' }, t('stoppedNow')));
              again.remove();
            }
            return;
          }
          if (canFinish(f)) {
            show('finish');
            return;
          }
          draw(f);
        } finally {
          // Keep checking, also after a failed read.
          if (alive() && !stopped) later(() => again.isConnected && !again.disabled && again.click(), env.pollMs.waiting);
        }
      });
    }

    draw(facts);
    later(() => again.isConnected && !again.disabled && again.click(), env.pollMs.waiting);
    return section(t('waitingTitle'), addressLine(t('account'), facts.account), body, h(doc, 'div', { class: 'actions' }, again), status);
  }

  // ---- 5. Finish ----

  function finishScreen(): HTMLElement {
    const keys = state.keys as WordAccounts;
    const facts = state.facts as AccountFacts;
    const status = statusLine();
    const picker = h(doc, 'div', { role: 'wallet-picker' });
    const owner = facts.request?.newOwners[0] ?? (newOwnerAddress() as Address);

    const finish = button(t('finishButton'), 'finish', () =>
      run(
        status,
        [finish],
        async (alive) => {
          status.textContent = t('sending');
          const sent = await finishTakeOver(state.chain, keys.guardian, facts.account, keys.guardian.address, { onSent: sentLine(status) });
          if (!alive()) return;
          state.facts = await readAccount(state.chain, facts.account, keys.guardian.address, sent.blockNumber);
          state.notice = state.newOwner.kind === 'words' ? t('finished') : t('finishedOwn', { address: owner });
          state.lastTx = sent.transactionHash;
          show('send');
        },
        { retry: () => recheck() },
      ),
    );

    function recheck(): void {
      run(status, [finish], async (alive) => {
        const f = await readAccount(state.chain, facts.account, keys.guardian.address);
        if (!alive()) return;
        if (!f.request && f.owners.length === 1 && isAddressEqual(f.owners[0]!, owner)) show('send');
        else if (!route(f)) status.textContent = t('refusal_no_take_over');
      }, { retry: recheck });
    }

    // A take-over to a wallet that is not the words' own is finished only after that wallet proves it is the
    // user's: the page never helps to finish someone else's take-over, and never calls it "yours".
    const needsProof = state.newOwner.kind === 'own' && !state.newOwner.proven;
    const prove = button(t('signWithWallet'), 'prove-wallet', () =>
      run(status, [prove], async (alive) => {
        await proveControl(await chooseWallet(picker), owner, facts.account);
        if (!alive()) return;
        state.newOwner = { kind: 'own', address: owner, proven: true };
        state.notice = t('proveDone');
        show('finish');
      }),
    );
    return section(
      t('finishTitle'),
      addressLine(t('account'), facts.account),
      needsProof ? h(doc, 'p', { class: 'notice', role: 'finish-needs-proof' }, t('finishNeedsProof', { address: owner })) : h(doc, 'p', {}, t('finishText')),
      otherRecovery(facts),
      feeBox(keys.guardian),
      h(doc, 'div', { class: 'actions' }, needsProof ? prove : finish),
      picker,
      status,
    );
  }

  // ---- 6. Send ----

  function sendScreen(): HTMLElement {
    const keys = state.keys as WordAccounts;
    const status = statusLine();
    const body = h(doc, 'div', { role: 'send-body' });
    const picker = h(doc, 'div', { role: 'wallet-picker' });
    const account = (state.facts as AccountFacts).account;

    function load(): void {
      run(
        status,
        [],
        async (alive) => {
          const facts = await readAccount(state.chain, account, keys.guardian.address);
          if (!alive()) return;
          state.facts = facts;
          if (facts.request) {
            route(facts);
            return;
          }
          const choice = chooseSendPath(state.chain, facts, keys.guardian, keys.guardian.address);
          const head: Child[] = [
            state.newOwner.kind === 'own' && facts.owners[0] ? addressLine(t('ownerIs'), facts.owners[0], 'owner') : null,
            otherRecovery(facts),
          ];
          if (choice.kind === 'not-supported') {
            body.replaceChildren(...head.filter((p): p is Node => !!p), h(doc, 'p', { class: 'notice', role: 'not-supported' }, t('notSupported')));
            return;
          }
          if (facts.eureBalance === 0n) {
            body.replaceChildren(...head.filter((p): p is Node => !!p), h(doc, 'p', { role: 'nothing-to-send' }, t('nothingToSend')));
            return;
          }
          const input = h(doc, 'input', { role: 'send-to', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: '0x...' } });
          const send = button(t('sendButton'), 'send', () => {
            const to = parseAddress(input.value);
            if (!to) {
              status.textContent = t('addressBad');
              status.classList.add('error');
              return;
            }
            run(
              status,
              [send],
              async (alive2) => {
                const prepared = await choice.path.prepare(to);
                if (!alive2()) return;
                confirm(prepared, choice.path);
              },
              { onError: (err) => (err instanceof PageRefusal ? err.reasons.map(destText).join(' ') : describe(err)) },
            );
          });
          body.replaceChildren(
            ...head.filter((p): p is Node => !!p),
            h(doc, 'p', {}, t('sendAmount', { amount: euro(facts.eureBalance) })),
            h(doc, 'label', {}, t('sendTo'), input),
            h(doc, 'div', { class: 'actions' }, send),
          );
        },
        { retry: load },
      );
    }

    function confirm(prepared: PreparedSend, path: SendPath): void {
      const own = state.newOwner.kind === 'own';
      const yes = button(t(own ? 'signWithWallet' : 'sendYes'), own ? 'sign-wallet' : 'send-yes', () =>
        run(status, [yes, no], async (alive) => {
          let signature: Hex;
          if (state.newOwner.kind === 'own') signature = await signWithWallet(await chooseWallet(picker), state.newOwner.address, prepared);
          else signature = await signWithKey(keys.newOwner, prepared);
          status.textContent = t('sending');
          const outcome = await path.submit(prepared, signature, { onSent: sentLine(status) });
          if (!alive()) return;
          status.replaceChildren();
          body.replaceChildren(
            h(doc, 'p', { class: 'notice', role: 'sent' }, t('sent', { amount: euro(prepared.amount), address: prepared.to })),
            h(doc, 'p', {}, txLink(outcome.transactionHash)),
          );
        }),
      );
      const no = button(t('back'), 'send-back', () => load(), false);
      body.replaceChildren(
        h(doc, 'p', { role: 'send-confirm' }, t('sendConfirm', { amount: euro(prepared.amount), address: prepared.to })),
        h(doc, 'div', { class: 'actions' }, yes, no),
      );
    }

    load();
    return section(t('sendTitle'), addressLine(t('account'), account), feeBox(keys.guardian), body, picker, status);
  }

  // Leaving the page drops the words and keys.
  doc.defaultView?.addEventListener('pagehide', clear);
  render();
  return { clear };
}

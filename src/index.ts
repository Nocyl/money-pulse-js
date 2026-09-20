/**
 * Money-Pulse JavaScript SDK
 * Official SDK for integrating Money-Pulse payments and payouts.
 * @module @money-pulse/checkout
 */

export interface MoneyPulseConfig {
  /** Your Money-Pulse API key (mp_live_xxx or mp_test_xxx) */
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface CreatePaymentParams {
  amount: number;
  currency: string;
  /** ISO 3166-1 alpha-2. Optionnel si customer.phone est un E.164 valide : le pays est alors deduit automatiquement (voir la doc /payments/initiate). */
  country?: string;
  description?: string;
  customer: { email: string; phone?: string; name?: string };
  methods?: string[];
  callbackUrl: string;
  returnUrl?: string;
  metadata?: Record<string, any>;
  /**
   * AUDIT 14/08/2026 : optionnel — si absent, un identifiant est généré
   * automatiquement pour chaque appel à create() (voir HttpClient.request()).
   * Fournissez le vôtre si vous voulez contrôler vous-même la fenêtre de
   * déduplication d'un retry réseau (ex. réutiliser le même id pour
   * plusieurs tentatives d'UN MÊME paiement logique).
   */
  idempotencyKey?: string;
}

export interface PaymentResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  checkoutUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreatePayoutParams {
  amount: number;
  currency: string;
  /** ISO 3166-1 alpha-2. Optionnel si recipient.phone est un E.164 valide : le pays est alors deduit automatiquement. */
  country?: string;
  recipient: { type: string; phone: string; name: string };
  description?: string;
  metadata?: Record<string, any>;
  /**
   * AUDIT 14/08/2026 (IMPORTANT pour un payout — de l'argent quitte
   * réellement le compte) : optionnel, généré automatiquement si absent.
   * Voir CreatePaymentParams.idempotencyKey pour l'explication complète.
   */
  idempotencyKey?: string;
}

export interface PayoutResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

class MoneyPulseError extends Error {
  code: string;
  statusCode: number;
  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'MoneyPulseError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * AUDIT 14/08/2026 : génère une clé d'idempotence par défaut pour chaque
 * appel create() qui n'en fournit pas une soi-même. Utilise
 * crypto.randomUUID() quand disponible (Node ≥14.17 et tous les
 * navigateurs modernes via l'API Web Crypto), avec un repli simple pour
 * les environnements plus anciens plutôt que de faire échouer le SDK.
 */
function generateIdempotencyKey(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Repli RFC4122 v4 approximatif -- suffisant pour l'usage de
  // déduplication visé ici, pas pour un besoin cryptographique.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class HttpClient {
  private baseUrl: string;
  private secretKey: string;
  private timeout: number;

  constructor(config: MoneyPulseConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.money-pulse.org').replace(/\/$/, '');
    this.secretKey = config.apiKey;
    this.timeout = config.timeout || 30000;
    // FIX (audit intégration 2026-07) : cette classe envoie apiKey en tant que
    // clé SECRÈTE (header X-Api-Key) à chaque requête -- elle n'est jamais
    // censée tourner dans un navigateur. Seule MoneyPulseCheckout (popup/
    // inline, plus bas dans ce fichier) est conçue pour le client-side, avec
    // une publicKey passée en query string, jamais comme secret. On avertit
    // clairement si ce n'est manifestement pas le cas, sans bloquer le code
    // existant qui en dépendrait déjà côté serveur (Node, bundler SSR...).
    if (typeof window !== 'undefined') {
      console.warn(
        '[MoneyPulse] new MoneyPulse({ apiKey }) envoie une clé SECRÈTE à chaque ' +
        'requête et ne doit JAMAIS être utilisé dans du code exécuté par le ' +
        'navigateur du client final. Pour un paiement côté client, utilisez ' +
        'MoneyPulseCheckout.open() ou MoneyPulseCheckout.inline() avec votre ' +
        'publicKey (mp_pub_...), jamais avec une clé secrète.'
      );
    }
  }

  async request<T>(method: string, path: string, body?: any, idempotencyKey?: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'X-Api-Key': this.secretKey,
        'Content-Type': 'application/json',
        'X-SDK': '@money-pulse/checkout/2.1.0',
      };
      // AUDIT 14/08/2026 : header Idempotency-Key ajouté quand fourni —
      // c'est le nom de header exact attendu par le middleware backend
      // (backend/src/middleware/idempotency.ts). Avant ce correctif, ce
      // SDK ne l'envoyait JAMAIS : même les routes backend protégées
      // (ex. /payments/payouts/initiate) ne recevaient donc aucune
      // protection réelle contre un double envoi en cas de retry réseau.
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const json = await res.json();

      if (!res.ok) {
        throw new MoneyPulseError(
          json.error?.message || json.error || 'Request failed',
          json.error?.code || 'unknown',
          res.status
        );
      }

      return json.data ?? json;
    } finally {
      clearTimeout(timer);
    }
  }
}

class PaymentResource {
  constructor(private client: HttpClient) {}

  /** Create a new payment */
  async create(params: CreatePaymentParams): Promise<PaymentResponse> {
    const idempotencyKey = params.idempotencyKey || generateIdempotencyKey();
    return this.client.request<PaymentResponse>('POST', '/api/v1/payments/initiate', params, idempotencyKey);
  }

  /**
   * Retrieve a payment's status by ID.
   * FIX (audit intégration 2026-07) : /api/v1/payments/{id} n'existe pas côté
   * backend. Seule /api/v1/payments/{id}/status existe (cf.
   * backend/src/routes/payments.ts) -- utilisée ici pour retrieve() ET
   * verify(), qui pointaient tous deux vers des routes inexistantes.
   */
  async retrieve(id: string): Promise<PaymentResponse> {
    return this.client.request<PaymentResponse>('GET', `/api/v1/payments/${id}/status`);
  }

  /** Verify a payment status (alias de retrieve() -- un seul endpoint réel derrière les deux) */
  async verify(id: string): Promise<{ id: string; status: string; verified: boolean }> {
    return this.client.request('GET', `/api/v1/payments/${id}/status`);
  }

  /** List payments with optional filters */
  async list(params?: { page?: number; limit?: number; status?: string }): Promise<{ data: PaymentResponse[]; total: number }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.status) qs.set('status', params.status);
    return this.client.request('GET', `/api/v1/payments?${qs.toString()}`);
  }
}

class PayoutResource {
  constructor(private client: HttpClient) {}

  /**
   * Create a new payout.
   * FIX (audit intégration 2026-07) : /api/v1/payouts/initiate n'existe pas
   * côté backend. La route réelle qui accepte `recipient` tel quel est
   * /api/v1/payments/payouts/initiate (cf. backend/src/routes/payments.ts).
   */
  async create(params: CreatePayoutParams): Promise<PayoutResponse> {
    const idempotencyKey = params.idempotencyKey || generateIdempotencyKey();
    return this.client.request<PayoutResponse>('POST', '/api/v1/payments/payouts/initiate', params, idempotencyKey);
  }

  /**
   * FIX (audit intégration 2026-07) : aucune route GET par identifiant
   * n'existe côté backend pour les payouts. On lève une erreur explicite
   * plutôt que d'appeler une URL qui renverrait un 404 silencieux.
   */
  async retrieve(id: string): Promise<PayoutResponse> {
    throw new MoneyPulseError(
      'payouts.retrieve() n\'est pas supporté par l\'API Money-Pulse actuelle : ' +
      'aucune route GET par identifiant n\'existe pour les payouts. Utilisez les ' +
      'webhooks de statut de payout pour suivre une transaction.',
      'not_supported',
      501
    );
  }

  /** Voir retrieve() -- même limitation, aucune route réelle derrière verify(). */
  async verify(id: string): Promise<{ id: string; status: string }> {
    throw new MoneyPulseError(
      'payouts.verify() n\'est pas supporté par l\'API Money-Pulse actuelle : ' +
      'aucune route GET par identifiant n\'existe pour les payouts. Utilisez les ' +
      'webhooks de statut de payout pour suivre une transaction.',
      'not_supported',
      501
    );
  }
}


/**
 * Main Money-Pulse SDK client.
 *
 * @example
 * ```typescript
 * const mp = new MoneyPulse({ apiKey: 'mp_live_votre_cle_api' });
 * const payment = await mp.payments.create({ ... });
 * ```
 */
export class MoneyPulse {
  public payments: PaymentResource;
  public payouts: PayoutResource;

  constructor(config: MoneyPulseConfig) {
    if (!config.apiKey) throw new Error('apiKey is required');
    const client = new HttpClient(config);
    this.payments = new PaymentResource(client);
    this.payouts = new PayoutResource(client);
  }
}

/**
 * Frontend checkout popup (for browser use).
 *
 * @example
 * ```typescript
 * MoneyPulseCheckout.open({
 *   publicKey: 'mp_pub_votre_cle_publique',
 *   amount: 10000,
 *   currency: 'XOF',
 *   onSuccess: (res) => console.log('Paid!', res),
 *   onError: (err) => console.error(err),
 * });
 * ```
 */
export class MoneyPulseCheckout {
  static open(options: {
    publicKey?: string;
    publishableKey?: string;
    amount: number;
    currency: string;
    country?: string;
    reference?: string;
    description?: string;
    customer?: { email?: string; phone?: string };
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    onReady?: () => void;
    onClose?: () => void;
    baseUrl?: string;
  }) {
    const base = (options.baseUrl || 'https://checkout.money-pulse.org').replace(/\/$/, '');
    const publishableKey = options.publicKey || options.publishableKey;
    if (!publishableKey) throw new Error('MoneyPulseCheckout.open: publicKey is required');
    const params = new URLSearchParams({
      pk: publishableKey,
      amount: String(options.amount),
      currency: options.currency,
      ...(options.country && { country: options.country }),
      ...(options.reference && { ref: options.reference }),
      ...(options.description && { desc: options.description }),
      ...(options.customer?.email && { email: options.customer.email }),
      ...(options.customer?.phone && { phone: options.customer.phone }),
    });

    const url = `${base}/?${params.toString()}`;
    const popup = window.open(url, 'MoneyPulseCheckout', 'width=450,height=700,scrollbars=yes');

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      const payload = event.data || {};
      const { type, data } = payload;
      if (type === 'mp:ready') {
        options.onReady?.();
        return;
      }
      if (type === 'mp:success' || type === 'payment.success') {
        options.onSuccess?.(data ?? payload);
        window.removeEventListener('message', handler);
      }
      if (type === 'mp:error' || type === 'payment.error') {
        options.onError?.(data ?? payload);
      }
      if (type === 'mp:close' || type === 'checkout.close') {
        options.onClose?.();
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', handler);
        options.onClose?.();
      }
    }, 500);
  }

  /**
   * Inline checkout — renders the payment form inside an existing DOM element.
   *
   * @example
   * ```typescript
   * MoneyPulseCheckout.inline('mp-checkout', {
   *   publicKey: 'mp_pub_votre_cle_publique',
   *   amount: 10000,
   *   currency: 'XOF',
   *   onSuccess: (res) => console.log('Paid!', res),
   * });
   * ```
   */
  static inline(containerId: string, options: {
    publicKey?: string;
    publishableKey?: string;
    amount: number;
    currency: string;
    country?: string;
    reference?: string;
    description?: string;
    customer?: { email?: string; phone?: string };
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    onReady?: () => void;
    baseUrl?: string;
  }) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[MoneyPulse] Container #${containerId} not found`);
      return;
    }

    const base = (options.baseUrl || 'https://checkout.money-pulse.org').replace(/\/$/, '');
    const publishableKey = options.publicKey || options.publishableKey;
    if (!publishableKey) throw new Error('MoneyPulseCheckout.inline: publicKey is required');
    const params = new URLSearchParams({
      pk: publishableKey,
      amount: String(options.amount),
      currency: options.currency,
      mode: 'inline',
      ...(options.country && { country: options.country }),
      ...(options.reference && { ref: options.reference }),
      ...(options.description && { desc: options.description }),
      ...(options.customer?.email && { email: options.customer.email }),
      ...(options.customer?.phone && { phone: options.customer.phone }),
    });

    const iframe = document.createElement('iframe');
    iframe.src = `${base}/?${params.toString()}`;
    iframe.style.width = '100%';
    iframe.style.minHeight = '500px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.setAttribute('allow', 'payment');
    iframe.setAttribute('allowtransparency', 'true');

    container.innerHTML = '';
    container.appendChild(iframe);

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      if (event.source !== iframe.contentWindow) return;
      const payload = event.data || {};
      const { type, data } = payload;
      if (type === 'mp:ready') options.onReady?.();
      if (type === 'mp:success' || type === 'payment.success') {
        options.onSuccess?.(data ?? payload);
        window.removeEventListener('message', handler);
      }
      if (type === 'mp:error' || type === 'payment.error') options.onError?.(data ?? payload);
    };
    window.addEventListener('message', handler);
  }

  /**
   * Ouvre en popup le lien de paiement d'une facture du moteur de
   * facturation récurrente (checkoutUrl retourné par
   * `POST /billing/subscriptions` côté serveur -- voir les SDK
   * Node/Python/PHP/Flutter, `billing.subscriptions.create()`). Même
   * mécanisme popup + postMessage que `open()`, mais sans reconstruire
   * l'URL : `checkoutUrl` est déjà complet, généré par le backend.
   *
   * @example
   * ```typescript
   * // Côté serveur : const { checkoutUrl } = await mp.billing.subscriptions.create(...);
   * // Côté navigateur, une fois checkoutUrl transmis au client :
   * MoneyPulseCheckout.openSubscription(checkoutUrl, {
   *   onSuccess: () => console.log('Abonnement payé !'),
   * });
   * ```
   */
  static openSubscription(checkoutUrl: string, options: {
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    onReady?: () => void;
    onClose?: () => void;
  } = {}) {
    const base = new URL(checkoutUrl).origin;
    const popup = window.open(checkoutUrl, 'MoneyPulseCheckout', 'width=450,height=700,scrollbars=yes');

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      const payload = event.data || {};
      const { type, data } = payload;
      if (type === 'mp:ready') { options.onReady?.(); return; }
      if (type === 'mp:success' || type === 'payment.success') {
        options.onSuccess?.(data ?? payload);
        window.removeEventListener('message', handler);
      }
      if (type === 'mp:error' || type === 'payment.error') options.onError?.(data ?? payload);
      if (type === 'mp:close' || type === 'checkout.close') {
        options.onClose?.();
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', handler);
        options.onClose?.();
      }
    }, 500);
  }

  /** Équivalent de `inline()` pour un checkoutUrl de facturation récurrente -- voir openSubscription(). */
  static inlineSubscription(containerId: string, checkoutUrl: string, options: {
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    onReady?: () => void;
  } = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[MoneyPulse] Container #${containerId} not found`);
      return;
    }
    const base = new URL(checkoutUrl).origin;

    const iframe = document.createElement('iframe');
    iframe.src = checkoutUrl;
    iframe.style.width = '100%';
    iframe.style.minHeight = '500px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.setAttribute('allow', 'payment');
    iframe.setAttribute('allowtransparency', 'true');

    container.innerHTML = '';
    container.appendChild(iframe);

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      if (event.source !== iframe.contentWindow) return;
      const payload = event.data || {};
      const { type, data } = payload;
      if (type === 'mp:ready') options.onReady?.();
      if (type === 'mp:success' || type === 'payment.success') {
        options.onSuccess?.(data ?? payload);
        window.removeEventListener('message', handler);
      }
      if (type === 'mp:error' || type === 'payment.error') options.onError?.(data ?? payload);
    };
    window.addEventListener('message', handler);
  }
}

export { MoneyPulseError };
export default MoneyPulse;

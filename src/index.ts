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
  country: string;
  description?: string;
  customer: { email: string; phone?: string; name?: string };
  methods?: string[];
  callbackUrl: string;
  returnUrl?: string;
  metadata?: Record<string, any>;
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
  country: string;
  recipient: { type: string; phone: string; name: string };
  description?: string;
  metadata?: Record<string, any>;
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

class HttpClient {
  private baseUrl: string;
  private secretKey: string;
  private timeout: number;

  constructor(config: MoneyPulseConfig) {
    this.baseUrl = (config.baseUrl || 'https://api.money-pulse.org').replace(/\/$/, '');
    this.secretKey = config.apiKey;
    this.timeout = config.timeout || 30000;
  }

  async request<T>(method: string, path: string, body?: any): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'X-Api-Key': this.secretKey,
          'Content-Type': 'application/json',
          'X-SDK': '@money-pulse/checkout/1.0.0',
        },
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
    return this.client.request<PaymentResponse>('POST', '/api/v1/payments/initiate', params);
  }

  /** Retrieve a payment by ID */
  async retrieve(id: string): Promise<PaymentResponse> {
    return this.client.request<PaymentResponse>('GET', `/api/v1/payments/${id}`);
  }

  /** Verify a payment status */
  async verify(id: string): Promise<{ id: string; status: string; verified: boolean }> {
    return this.client.request('GET', `/api/v1/payments/${id}/verify`);
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

  /** Create a new payout */
  async create(params: CreatePayoutParams): Promise<PayoutResponse> {
    return this.client.request<PayoutResponse>('POST', '/api/v1/payouts/initiate', params);
  }

  /** Retrieve a payout by ID */
  async retrieve(id: string): Promise<PayoutResponse> {
    return this.client.request<PayoutResponse>('GET', `/api/v1/payouts/${id}`);
  }

  /** Verify payout status */
  async verify(id: string): Promise<{ id: string; status: string }> {
    return this.client.request('GET', `/api/v1/payouts/${id}/verify`);
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
    publicKey: string;
    amount: number;
    currency: string;
    description?: string;
    customer?: { email?: string; phone?: string };
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    onClose?: () => void;
    baseUrl?: string;
  }) {
    const base = (options.baseUrl || 'https://checkout.money-pulse.org').replace(/\/$/, '');
    const params = new URLSearchParams({
      key: options.publicKey,
      amount: String(options.amount),
      currency: options.currency,
      ...(options.description && { desc: options.description }),
      ...(options.customer?.email && { email: options.customer.email }),
      ...(options.customer?.phone && { phone: options.customer.phone }),
    });

    const url = `${base}/pay?${params.toString()}`;
    const popup = window.open(url, 'MoneyPulseCheckout', 'width=450,height=700,scrollbars=yes');

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      const { type, data } = event.data || {};
      if (type === 'payment.success') options.onSuccess?.(data);
      if (type === 'payment.error') options.onError?.(data);
      if (type === 'checkout.close') options.onClose?.();
      window.removeEventListener('message', handler);
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
    publicKey: string;
    amount: number;
    currency: string;
    description?: string;
    customer?: { email?: string; phone?: string };
    onSuccess?: (response: any) => void;
    onError?: (error: any) => void;
    baseUrl?: string;
  }) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[MoneyPulse] Container #${containerId} not found`);
      return;
    }

    const base = (options.baseUrl || 'https://checkout.money-pulse.org').replace(/\/$/, '');
    const params = new URLSearchParams({
      key: options.publicKey,
      amount: String(options.amount),
      currency: options.currency,
      mode: 'inline',
      ...(options.description && { desc: options.description }),
      ...(options.customer?.email && { email: options.customer.email }),
      ...(options.customer?.phone && { phone: options.customer.phone }),
    });

    const iframe = document.createElement('iframe');
    iframe.src = `${base}/pay?${params.toString()}`;
    iframe.style.width = '100%';
    iframe.style.minHeight = '500px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '12px';
    iframe.setAttribute('allowtransparency', 'true');

    container.innerHTML = '';
    container.appendChild(iframe);

    const handler = (event: MessageEvent) => {
      if (event.origin !== base) return;
      const { type, data } = event.data || {};
      if (type === 'payment.success') options.onSuccess?.(data);
      if (type === 'payment.error') options.onError?.(data);
    };
    window.addEventListener('message', handler);
  }
}

export { MoneyPulseError };
export default MoneyPulse;

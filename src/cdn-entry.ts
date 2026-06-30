import { MoneyPulseCheckout } from './index';

declare global {
  interface Window {
    MoneyPulseCheckout: typeof MoneyPulseCheckout;
  }
}

if (typeof window !== 'undefined') {
  window.MoneyPulseCheckout = MoneyPulseCheckout;
}

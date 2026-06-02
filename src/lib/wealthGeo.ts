// Kaya Wealth · light geography helpers for the global rollout.
//
// Country-aware bank suggestions + property address formats. Curated lists
// for the launch markets; "Other" is ALWAYS available (the inputs are free
// text, so any bank / address can still be typed). A genuine AI lookup can
// extend these later — for now a fast, reliable curated set.

export interface CountryDef {
  code: string;
  name: string;
  flag: string;
  banks: string[];
  addressPlaceholder: string;
}

export const COUNTRIES: CountryDef[] = [
  { code: 'TZ', name: 'Tanzania',        flag: '🇹🇿', banks: ['CRDB Bank', 'NMB Bank', 'NBC', 'Stanbic Bank', 'Equity Bank', 'Absa', 'Exim Bank', 'DTB', 'Azania Bank', 'Akiba'], addressPlaceholder: 'Plot / Block · Street · Ward · District · Region' },
  { code: 'US', name: 'United States',   flag: '🇺🇸', banks: ['Chase', 'Bank of America', 'Wells Fargo', 'Citibank', 'U.S. Bank', 'Capital One', 'PNC', 'Truist', 'Ally'], addressPlaceholder: 'Street · City · State · ZIP' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', banks: ['Emirates NBD', 'First Abu Dhabi Bank (FAB)', 'ADCB', 'Mashreq', 'Dubai Islamic Bank', 'RAKBANK', 'ADIB'], addressPlaceholder: 'Villa / Apt · Street · Area · Emirate' },
  { code: 'KE', name: 'Kenya',           flag: '🇰🇪', banks: ['Equity Bank', 'KCB', 'Co-operative Bank', 'NCBA', 'Absa Kenya', 'Stanbic', 'DTB', 'I&M Bank'], addressPlaceholder: 'House / Plot · Estate · Town · County' },
  { code: 'GB', name: 'United Kingdom',  flag: '🇬🇧', banks: ['Barclays', 'HSBC', 'Lloyds', 'NatWest', 'Santander', 'Halifax', 'Monzo', 'Starling'], addressPlaceholder: 'House · Street · Town · Postcode' },
  { code: 'NG', name: 'Nigeria',         flag: '🇳🇬', banks: ['GTBank', 'Access Bank', 'Zenith Bank', 'First Bank', 'UBA', 'Stanbic IBTC', 'Kuda'], addressPlaceholder: 'House · Street · Area · City · State' },
  { code: 'ZA', name: 'South Africa',    flag: '🇿🇦', banks: ['Standard Bank', 'FNB', 'Absa', 'Nedbank', 'Capitec', 'Investec'], addressPlaceholder: 'Unit · Street · Suburb · City · Postal code' },
  { code: 'IN', name: 'India',           flag: '🇮🇳', banks: ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra', 'Punjab National Bank'], addressPlaceholder: 'House · Street · Locality · City · State · PIN' },
  { code: 'OTHER', name: 'Other (not listed)', flag: '🌍', banks: [], addressPlaceholder: 'Address' },
];

export function countryDef(code: string): CountryDef {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[COUNTRIES.length - 1];
}

const CURRENCY_COUNTRY: Record<string, string> = {
  TZS: 'TZ', USD: 'US', AED: 'AE', KES: 'KE', GBP: 'GB', NGN: 'NG', ZAR: 'ZA', INR: 'IN',
};

/** A sensible default country for a household currency (best-effort). */
export function countryForCurrency(cur: string): string {
  return CURRENCY_COUNTRY[cur] ?? 'TZ';
}

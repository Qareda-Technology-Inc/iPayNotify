// Vendor data interface for template functions
export interface VendorData {
  name?: string;
  contact_phone?: string;
  slogan?: string;
}

function toOrdinalDate(date: Date): string {
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const year = date.getFullYear();
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd'
    : 'th';
  return `${day}${suffix} ${month}, ${year}`;
}

function firstName(fullName: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return 'Customer';
  const parts = trimmed.split(/\s+/);
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

export function templateWelcome(fullName: string, endDate: Date, vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  const name = firstName(fullName);
  const endStr = toOrdinalDate(endDate);
  let msg = `${business}: 🎉 Welcome ${name}! Your internet service is active until ${endStr}. Need help? Call ${phone} or WhatsApp ${whatsapp}. Reply CALL if you want us to reach out.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templatePaymentConfirmation(fullName: string, totalAmount: number, newEndDate: Date, vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  const name = firstName(fullName);
  const endStr = toOrdinalDate(newEndDate);
  let msg = `${business}: ✅ Payment GHC ${totalAmount.toFixed(2)} received. Thanks, ${name}! Your new expiry is ${endStr}. Questions? Call ${phone} or WhatsApp ${whatsapp}.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templateActivation(fullName: string, newEndDate: Date, vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  const name = firstName(fullName);
  const endStr = toOrdinalDate(newEndDate);
  let msg = `${business}: 🚀 Service reactivated, ${name}! You're online until ${endStr}. Renew anytime via ${phone} or WhatsApp ${whatsapp}. Reply HELP for support.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templateExpiring(fullName: string, daysLeft: number, endDate: Date, vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  const name = firstName(fullName);
  const endStr = toOrdinalDate(endDate);
  if (daysLeft <= 0) {
    return templateExpired(fullName, Math.abs(daysLeft), endDate, vendor);
  }
  let msg = `${business}: ⏰ Hi ${name}, your subscription ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''} on ${endStr}. Renew now: call ${phone} or WhatsApp ${whatsapp}. Reply RENEW and we'll call you back.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templateExpired(fullName: string, daysAgo: number, endDate: Date, vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  const name = firstName(fullName);
  const endStr = toOrdinalDate(endDate);
  let msg = `${business}: ❗ ${name}, your service expired ${daysAgo} day${daysAgo > 1 ? 's' : ''} ago (on ${endStr}). Reactivate today: call ${phone} or WhatsApp ${whatsapp}. Reply CALL for assistance.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templateMaintenance(windowText: string = '11 PM - 2 AM', vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  const whatsapp = vendor?.contact_phone || '0241234567';
  let msg = `${business}: 🛠️ Scheduled maintenance tonight (${windowText}). You may notice brief interruptions. We'll be quick. Need help? ${phone} / WhatsApp ${whatsapp}.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}

export function templateNetworkUpdate(vendor?: VendorData): string {
  const business = vendor?.name || 'Qaretech Innovative';
  const phone = vendor?.contact_phone || '0241234567';
  let msg = `${business}: 🆕 Network upgrade complete! Enjoy improved speed and reliability. If you notice issues, please restart your devices or contact ${phone}.`;
  return vendor?.slogan ? `${msg}\n\n${vendor.slogan}` : msg;
}



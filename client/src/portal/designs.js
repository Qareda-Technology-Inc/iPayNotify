import { TICKET_DESIGNS } from '../utils/exportVouchersPdf.js';

/** Ticket printout designs (login page designs are rendered by the API — see /api/organization/portal-previews). */
export const VOUCHER_DESIGNS = TICKET_DESIGNS;

export function voucherDesignById(id) {
  return VOUCHER_DESIGNS.find((d) => d.id === id) || VOUCHER_DESIGNS[0];
}

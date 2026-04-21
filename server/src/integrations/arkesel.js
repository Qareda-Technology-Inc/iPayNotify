import { config } from '../config.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

function isArkeselSuccessJson(data, resOk) {
  if (!resOk) return false;
  if (data == null || typeof data !== 'object') return true;
  if (data.success === false) return false;
  if (data.Status === 'Error' || data.status === 'error') return false;
  const code = data.code;
  if (code != null && String(code).toLowerCase() === 'error') return false;
  return true;
}

/**
 * Send SMS via Arkesel (Ghana).
 * @see https://sms.arkesel.com/api/v2/sms/send — header `api-key`, body sender, message, recipients[]
 */
export async function sendArkeselSms({ to, message, senderId: senderIdOverride }) {
  const { apiKey, senderId, smsUrl, mock } = config.arkesel;
  const effectiveSender = String(senderIdOverride || senderId || '').trim();
  const text = String(message || '').trim();
  if (!text) {
    return { ok: false, error: 'empty_message' };
  }

  if (mock) {
    console.log('[Arkesel mock SMS]', { to, message: text.slice(0, 160) });
    return { ok: true, mock: true };
  }

  if (!apiKey || !effectiveSender) {
    return { ok: false, skipped: true, reason: 'arkesel_not_configured' };
  }

  const phone = normalizeGhanaMsisdn(to);
  if (!phone) {
    return { ok: false, error: 'invalid_phone' };
  }

  const payload = {
    sender: effectiveSender,
    message: text.slice(0, 1000),
    recipients: [phone],
  };

  const doFetch = async () => {
    const res = await fetch(smsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
    const rawText = await res.text();
    let data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        return {
          res,
          data: {
            parseError: true,
            _snippet: rawText.slice(0, 300),
          },
        };
      }
    }
    return { res, data };
  };

  try {
    let { res, data } = await doFetch();

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      ({ res, data } = await doFetch());
    }

    if (data.parseError) {
      return {
        ok: false,
        error: 'non_json_response',
        status: res.status,
        raw: data._snippet,
      };
    }

    if (!isArkeselSuccessJson(data, res.ok)) {
      return {
        ok: false,
        error:
          data.message ||
          data.Message ||
          data.error ||
          data.msg ||
          res.statusText,
        status: res.status,
        raw: data,
      };
    }

    return { ok: true, raw: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function arkeselLiveReady() {
  const { apiKey, senderId, mock } = config.arkesel;
  return !mock && Boolean(apiKey) && Boolean(senderId);
}

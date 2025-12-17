// SMS Service using Arkesel API
// Arkesel is a popular SMS gateway service in Ghana and West Africa

interface ArkeselConfig {
  apiKey: string;
  senderId: string;
}

// Configuration - In production, these should be environment variables
const ARKESEL_CONFIG: ArkeselConfig = {
  apiKey: import.meta.env.VITE_ARKESEL_API_KEY || '',
  senderId: import.meta.env.VITE_ARKESEL_SENDER_ID || 'Qaretech'
};

// GSM-7 detection: if message contains chars outside GSM-7, we should send as unicode
const GSM7_REGEX = /^[\u0000-\u007F€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæÉ!\"#\$%&'\(\)\*\+,\-\.\/0-9:;<=>\?@A-ZÄÖÑÜ§a-zäöñüà\s\r\n]*$/;
function isGsm7(text: string): boolean {
  return GSM7_REGEX.test(text);
}

function providerAccepts(result: any): boolean {
  // Arkesel commonly returns status or code fields on success
  const status = (result?.status || '').toString().toLowerCase();
  const code = (result?.code || '').toString().toLowerCase();
  // Accept common success indicators
  if (status === 'success' || status === 'accepted' || status === 'queued') return true;
  if (code === '200' || code === 'ok' || code === '201') return true;
  // Sometimes presence of data.id indicates acceptance
  if (result?.data && (result.data.id || result.data.message_id)) return true;
  return false;
}

export async function sendSMS(to: string, message: string, senderId?: string): Promise<void> {
  // Check if SMS is configured
  if (!ARKESEL_CONFIG.apiKey) {
    throw new Error('SMS service not configured. Please set up Arkesel API key in environment variables.');
  }

  // Use provided senderId or fall back to config/default
  // Sender ID must be alphanumeric, max 11 characters, no spaces
  const finalSenderId = senderId 
    ? senderId.replace(/\s+/g, '').substring(0, 11)
    : ARKESEL_CONFIG.senderId;

  // Format phone number for Ghana (remove + and ensure it starts with 233)
  let formattedPhone = to.replace(/\s+/g, '').replace(/^\+/, '');
  
  // If it starts with 0, replace with 233
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '233' + formattedPhone.substring(1);
  }
  
  // If it doesn't start with 233, assume it's a local number and add 233
  if (!formattedPhone.startsWith('233')) {
    formattedPhone = '233' + formattedPhone;
  }

  try {
    // Arkesel SMS API endpoint
    const url = 'https://sms.arkesel.com/api/v2/sms/send';
    
    // Prepare request data
    const needsUnicode = !isGsm7(message);
    const requestData: Record<string, any> = {
      sender: finalSenderId,
      message: message,
      recipients: [formattedPhone]
    };
    // Hint to provider about encoding if message has emojis or non-GSM characters
    if (needsUnicode) {
      requestData.type = 'unicode';
      requestData.unicode = true;
    }

    console.log('Sending SMS via Arkesel:', { to: formattedPhone, sender: finalSenderId });

    // Make API request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': ARKESEL_CONFIG.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    const result = await response.json();
    console.log('Arkesel API response:', result);

    if (!response.ok || !providerAccepts(result)) {
      const providerMsg = result?.message || result?.status || 'Unknown provider response';
      throw new Error(`Arkesel rejected/failed: ${providerMsg} (HTTP ${response.status})`);
    }

    console.log('SMS sent successfully via Arkesel:', result.data?.id || 'No ID returned');
    
  } catch (error) {
    console.error('Arkesel SMS sending failed:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to send SMS via Arkesel');
  }
}

// Alternative function for bulk SMS sending (Arkesel supports this)
export async function sendBulkSMS(recipients: string[], message: string, senderId?: string): Promise<{ successful: number; failed: number; errors: string[] }> {
  if (!ARKESEL_CONFIG.apiKey) {
    throw new Error('SMS service not configured. Please set up Arkesel API key in environment variables.');
  }

  // Use provided senderId or fall back to config/default
  // Sender ID must be alphanumeric, max 11 characters, no spaces
  const finalSenderId = senderId 
    ? senderId.replace(/\s+/g, '').substring(0, 11)
    : ARKESEL_CONFIG.senderId;

  // Format all phone numbers
  const formattedRecipients = recipients.map(phone => {
    let formatted = phone.replace(/\s+/g, '').replace(/^\+/, '');
    
    if (formatted.startsWith('0')) {
      formatted = '233' + formatted.substring(1);
    }
    
    if (!formatted.startsWith('233')) {
      formatted = '233' + formatted;
    }
    
    return formatted;
  });

  try {
    const url = 'https://sms.arkesel.com/api/v2/sms/send';
    
    const requestData = {
      sender: finalSenderId,
      message: message,
      recipients: formattedRecipients
    };

    console.log('Sending bulk SMS via Arkesel:', { count: formattedRecipients.length, sender: finalSenderId });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': ARKESEL_CONFIG.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    const result = await response.json();
    console.log('Arkesel bulk SMS response:', result);

    if (!response.ok) {
      throw new Error(result.message || `HTTP error! status: ${response.status}`);
    }

    // Check if Arkesel returned success for bulk SMS
    if (result.code && result.code !== '200' && result.code !== 200 && result.code !== 'ok' && result.status !== 'success') {
      // Only throw error if there's actually an error response
      if (result.message && result.message.toLowerCase().includes('error')) {
        throw new Error(result.message || 'Bulk SMS sending failed');
      }
    }

    // Return success info
    return {
      successful: formattedRecipients.length,
      failed: 0,
      errors: []
    };
    
  } catch (error) {
    console.error('Arkesel bulk SMS failed:', error);
    return {
      successful: 0,
      failed: formattedRecipients.length,
      errors: [error instanceof Error ? error.message : 'Failed to send bulk SMS']
    };
  }
}

// Test SMS function for debugging
export async function sendTestSMS(): Promise<void> {
  const testMessage = "Test message from Qaretech Innovative subscription system. If you receive this, SMS is working correctly!";
  const testNumber = "233241234567"; // Replace with your test number
  
  try {
    await sendSMS(testNumber, testMessage);
    console.log('Test SMS sent successfully!');
  } catch (error) {
    console.error('Test SMS failed:', error);
    throw error;
  }
}
import { logger } from "@/lib/logger";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Mail delivery abstraction. The MVP ships a log transport that records delivery intent without
 * secrets. Replace `transport` with SMTP/SES/SendGrid implementations without touching callers.
 */
export interface MailTransport {
  send(message: OutgoingMail): Promise<void>;
}

const logTransport: MailTransport = {
  async send(message) {
    logger.info("mail_queued", { to: message.to, subject: message.subject, transport: "log" });
  },
};

let transport: MailTransport = logTransport;

export function setMailTransport(next: MailTransport): void {
  transport = next;
}

export async function sendMail(message: OutgoingMail): Promise<void> {
  try {
    await transport.send(message);
  } catch (err) {
    logger.error("mail_delivery_failed", { to: message.to, error: err instanceof Error ? err.message : "unknown" });
  }
}

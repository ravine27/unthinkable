import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  isTransient?: boolean;
}

let transporter: Transporter | null = null;
let isConfigured = false;

function initTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT
    ? parseInt(process.env.SMTP_PORT, 10)
    : undefined;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    return null;
  }

  try {
    const t = nodemailer.createTransport({
      host,
      port: port || 587,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    isConfigured = true;
    return t;
  } catch (err: any) {
    console.error(
      '[Email] Failed to initialize SMTP transporter:',
      err?.message || err
    );

    return null;
  }
}

export function isSmtpConfigured(): boolean {
  if (transporter) {
    return isConfigured;
  }

  transporter = initTransporter();

  return Boolean(transporter);
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailOptions): Promise<SendEmailResult> {
  if (!transporter) {
    transporter = initTransporter();
  }

  if (!transporter) {
    console.log('[Email] SMTP not configured; notification queued');

    return {
      success: false,
      error: 'SMTP not configured',
      isTransient: false,
    };
  }

  const from =
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER ||
    'no-reply@mediflow.com';

  try {
    const info = await transporter.sendMail({
      from: `MediFlow <${from}>`,
      to,
      subject,
      text,
      html: html || text,
    });

    console.log(
      `[Email] Successfully sent email to ${to} (Message ID: ${info.messageId})`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);

    console.error(
      `[Email] Error sending email to ${to}:`,
      errorMessage
    );

    const code = err?.code || '';
    const responseCode = err?.responseCode || 0;

    const isPermanent =
      code === 'EAUTH' ||
      responseCode === 535 ||
      responseCode === 550 ||
      errorMessage.toLowerCase().includes('invalid recipient') ||
      errorMessage.toLowerCase().includes('authentication failed');

    return {
      success: false,
      error: errorMessage,
      isTransient: !isPermanent,
    };
  }
}
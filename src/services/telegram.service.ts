import axios from 'axios';
import type { Complaint, Subscription, User } from '@prisma/client';
import prisma from '@/services/prisma.service';
import { ConfigLoader } from '@/configs/configLoader';
import { logger } from '@/utils/logger';

// Env vars (resolved via ConfigLoader, supports LOCAL_/DEV_/PROD_ prefixes):
//   TELEGRAM_BOT_TOKEN — bot token from @BotFather
//   TELEGRAM_CHAT_ID   — target chat / channel / group ID

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (date: Date | string | undefined | null): string =>
  date
    ? new Date(date).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      })
    : '—';

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Appends a collapsible raw JSON block. Telegram renders <pre> with a native Copy button. */
const jsonBlock = (obj: unknown): string => {
  const raw = JSON.stringify(obj, null, 2);
  const truncated = raw.length > 1800 ? `${raw.slice(0, 1800)}\n... (truncated)` : raw;
  return `\n\n📋 <b>Raw JSON</b>\n<pre><code class="language-json">${escHtml(truncated)}</code></pre>`;
};

const line = (emoji: string, label: string, value: unknown): string =>
  value !== undefined && value !== null && value !== ''
    ? `${emoji} <b>${label}:</b> ${escHtml(String(value))}\n`
    : '';

type ComplaintLike = Complaint & { user?: Pick<User, 'firstName' | 'lastName' | 'phoneNo'> | null };

const userLines = (u: Pick<User, 'firstName' | 'lastName' | 'phoneNo'> | null | undefined, fallbackId?: string | null) => {
  if (u) {
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Unknown';
    return line('👤', 'User', name) + line('📱', 'Phone', u.phoneNo);
  }
  return line('👤', 'User ID', fallbackId);
};

async function fetchAddressLine(addressId: string | null | undefined): Promise<string | null> {
  if (!addressId) return null;
  const a = await prisma.address.findUnique({ where: { id: addressId } });
  if (!a) return null;

  const parts = [
    a.title ? `[${a.title}]` : null,
    a.houseNo,
    a.societyName,
    a.addressLineOne,
    a.addressLineTwo,
    a.area,
    a.city,
    a.state,
    a.pinCode ? `- ${a.pinCode}` : null,
    a.country,
  ].filter(Boolean);

  return parts.join(', ');
}

// ─── Core send ────────────────────────────────────────────────────────────────

export class TelegramService {
  private static async send(html: string): Promise<void> {
    const botToken = ConfigLoader.resolve('TELEGRAM_BOT_TOKEN');
    const chatId = ConfigLoader.resolve('TELEGRAM_CHAT_ID');

    if (!botToken || !chatId) {
      logger.warn('[Telegram] BOT_TOKEN or CHAT_ID not set — skipping notification');
      return;
    }

    try {
      await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { timeout: 8000 },
      );
    } catch (err) {
      // Never throw — notifications must never crash the main flow
      const axiosErr = err as { response?: { data?: unknown }; message?: string };
      logger.error('[Telegram] Failed to send notification:', axiosErr?.response?.data ?? axiosErr?.message);
    }
  }

  // ─── Formatters ───────────────────────────────────────────────────────────

  static async notifyNewUser(user: User): Promise<void> {
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Unknown';
    const html =
      `🆕 <b>New User Registered</b>\n` +
      `${'─'.repeat(28)}\n` +
      line('👤', 'Name', name) +
      line('📱', 'Phone', user.phoneNo) +
      line('📧', 'Email', user.email) +
      line('🏷', 'Role', user.role) +
      line('🆔', 'User ID', user.id) +
      line('📅', 'Registered', fmt(user.createdAt)) +
      jsonBlock(user);

    await TelegramService.send(html);
  }

  static async notifyComplaintCreated(complaint: ComplaintLike): Promise<void> {
    const address = await fetchAddressLine(complaint.addressId);

    const html =
      `🔧 <b>New Complaint Created</b>\n` +
      `${'─'.repeat(28)}\n` +
      line('🆔', 'Complaint ID', complaint.id) +
      line('📌', 'Title', complaint.title) +
      userLines(complaint.user, complaint.userId) +
      line('📍', 'Address', address) +
      line('🛠', 'Provider', complaint.providerId ?? 'Unassigned') +
      line('📟', 'Device Type', complaint.deviceKey) +
      line('🗂', 'Stage', complaint.stage) +
      line('💳', 'Subscription', complaint.subscriptionId ? `#${complaint.subscriptionId}` : 'None') +
      line('📝', 'Notes', complaint.notes) +
      line('📅', 'Created', fmt(complaint.createdAt)) +
      jsonBlock(complaint);

    await TelegramService.send(html);
  }

  static async notifyComplaintUpdated(
    complaint: ComplaintLike,
    changes?: Record<string, unknown>,
  ): Promise<void> {
    let changesBlock = '';
    if (changes && Object.keys(changes).length > 0) {
      const changeLines = Object.entries(changes)
        .map(([k, v]) => `  • <b>${escHtml(k)}:</b> ${escHtml(String(v))}`)
        .join('\n');
      changesBlock = `\n✏️ <b>Changes:</b>\n${changeLines}\n`;
    }

    const html =
      `🔄 <b>Complaint Updated</b>\n` +
      `${'─'.repeat(28)}\n` +
      line('🆔', 'Complaint ID', complaint.id) +
      line('📌', 'Title', complaint.title) +
      userLines(complaint.user, complaint.userId) +
      line('🗂', 'Stage', complaint.stage) +
      line('📅', 'Updated', fmt(complaint.updatedAt)) +
      changesBlock +
      jsonBlock(complaint);

    await TelegramService.send(html);
  }

  static async notifySubscriptionCreated(sub: Subscription): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: sub.userId },
      select: { firstName: true, lastName: true, phoneNo: true },
    });

    const addons = Array.isArray(sub.addons)
      ? (sub.addons as Array<{ name?: string }>).map((a) => a.name).filter(Boolean).join(', ') || 'None'
      : 'None';

    const html =
      `💳 <b>New Subscription Registered</b>\n` +
      `${'─'.repeat(28)}\n` +
      line('🆔', 'Subscription ID', sub.id) +
      userLines(user, sub.userId) +
      line('📦', 'Plan', sub.planName) +
      line('🏷', 'Device Type', sub.deviceTypeKey) +
      line('🔁', 'Billing Cycle', sub.billingCycle) +
      line('🔢', 'Max Services', sub.maxServices) +
      line('💵', 'Total Amount', `₹${sub.totalAmount}`) +
      line('🧩', 'Addons', addons) +
      line('📅', 'Starts', fmt(sub.startDate)) +
      line('📅', 'Expires', fmt(sub.endDate)) +
      line('⚡', 'Status', sub.status) +
      jsonBlock(sub);

    await TelegramService.send(html);
  }

  static async notifyPaymentVerified(params: {
    userId: string;
    subscriptionId?: string;
    amountRupees: number;
    razorpayPaymentId: string;
    ledgerId?: string;
  }): Promise<void> {
    const { userId, subscriptionId, amountRupees, razorpayPaymentId, ledgerId } = params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, phoneNo: true },
    });

    const html =
      `💰 <b>Payment Verified</b>\n` +
      `${'─'.repeat(28)}\n` +
      userLines(user, userId) +
      line('💵', 'Amount Paid', `₹${amountRupees}`) +
      line('🆔', 'Subscription ID', subscriptionId) +
      line('🧾', 'Ledger ID', ledgerId) +
      line('🔑', 'Razorpay ID', razorpayPaymentId) +
      line('📅', 'Verified', fmt(new Date()));

    await TelegramService.send(html);
  }
}

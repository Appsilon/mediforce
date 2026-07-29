/**
 * Shared brand shell for transactional emails (invite / activation / magic
 * link). Pure string builders, framework-free, so both `platform-api`
 * (invite-emails) and `platform-ui` (magic-link) render the same header /
 * teal button / footer without forming a cross-package dependency edge.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emailLayout(senderName: string, bodyHtml: string, footerText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">

        <!-- Header -->
        <tr><td style="background:#1c8879;border-radius:8px 8px 0 0;padding:28px 32px">
          <p style="margin:0;font-size:18px;font-weight:600;color:#ffffff;letter-spacing:-0.3px">${escapeHtml(senderName)}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:32px">
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#ffffff;border-top:1px solid #f4f4f5;border-radius:0 0 8px 8px;padding:20px 32px">
          <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5">${escapeHtml(footerText)}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

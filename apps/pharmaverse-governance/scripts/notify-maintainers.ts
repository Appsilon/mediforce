import { readFile, writeFile } from 'node:fs/promises';

const TEST_FILTER = ['rhino'];

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'governance@pharmaverse.org';

interface ReportEntry {
  packageName: string;
  pdfPath: string;
}

interface PackageInfo {
  name: string;
  maintainerName?: string;
  maintainerEmail?: string;
}

interface InputData {
  reports: ReportEntry[];
  steps: Record<string, Record<string, unknown>>;
}

interface NotificationResult {
  packageName: string;
  maintainerEmail: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
}

interface OutputData {
  notifications: NotificationResult[];
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  sentAt: string;
}

function formatMonthYear(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function buildEmailHtml(maintainerName: string, packageName: string, monthYear: string): string {
  return [
    '<h2>Pharmaverse Governance Report</h2>',
    `<p>Dear ${maintainerName},</p>`,
    `<p>Please find attached the governance review report for <strong>${packageName}</strong> from the ${monthYear} semiannual review cycle.</p>`,
    '<p>This report summarizes the current governance status, quality badge assessments, and any action items for your package.</p>',
    '<p>If you have questions, please contact the Pharmaverse Governance Council.</p>',
    '<p>Best regards,<br>Pharmaverse Governance Council</p>',
  ].join('\n');
}

async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  pdfAttachment: Buffer,
  pdfFilename: string,
): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: 'Pharmaverse Governance' },
      subject,
      content: [{ type: 'text/html', value: htmlBody }],
      attachments: [
        {
          content: pdfAttachment.toString('base64'),
          filename: pdfFilename,
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid API error ${response.status}: ${body}`);
  }
}

async function main(): Promise<void> {
  console.log('Reading input from /output/input.json...');
  const raw = await readFile('/output/input.json', 'utf-8');
  const input = JSON.parse(raw) as InputData;

  const discoverData = input.steps['discover-packages'] as { packages?: PackageInfo[] } | undefined;
  const packagesList = discoverData?.packages ?? [];
  const packagesByName = new Map<string, PackageInfo>();
  for (const pkg of packagesList) {
    packagesByName.set(pkg.name, pkg);
  }

  const monthYear = formatMonthYear();
  const notifications: NotificationResult[] = [];

  const filteredReports = input.reports.filter((report) => TEST_FILTER.includes(report.packageName));
  console.log(
    `Processing ${filteredReports.length} reports (filtered from ${input.reports.length} total, TEST_FILTER: ${TEST_FILTER.join(', ')})`,
  );

  for (const report of filteredReports) {
    const pkg = packagesByName.get(report.packageName);
    const maintainerEmail = pkg?.maintainerEmail ?? null;
    const maintainerName = pkg?.maintainerName ?? report.packageName;

    if (!SENDGRID_API_KEY) {
      console.log(`  ${report.packageName}: skipped (SENDGRID_API_KEY not set)`);
      notifications.push({
        packageName: report.packageName,
        maintainerEmail,
        status: 'skipped',
        error: 'SENDGRID_API_KEY not set',
      });
      continue;
    }

    if (maintainerEmail === null) {
      console.log(`  ${report.packageName}: skipped (no maintainer email found)`);
      notifications.push({
        packageName: report.packageName,
        maintainerEmail: null,
        status: 'skipped',
        error: 'No maintainer email found',
      });
      continue;
    }

    try {
      const pdfBuffer = await readFile(report.pdfPath);
      const subject = `Pharmaverse Governance Report — ${report.packageName} — ${monthYear}`;
      const htmlBody = buildEmailHtml(maintainerName, report.packageName, monthYear);
      const pdfFilename = `governance-report-${report.packageName}.pdf`;

      await sendEmail(maintainerEmail, subject, htmlBody, pdfBuffer, pdfFilename);

      console.log(`  ${report.packageName}: sent to ${maintainerEmail}`);
      notifications.push({
        packageName: report.packageName,
        maintainerEmail,
        status: 'sent',
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ${report.packageName}: failed — ${errorMessage}`);
      notifications.push({
        packageName: report.packageName,
        maintainerEmail,
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  const totalSent = notifications.filter((n) => n.status === 'sent').length;
  const totalFailed = notifications.filter((n) => n.status === 'failed').length;
  const totalSkipped = notifications.filter((n) => n.status === 'skipped').length;

  const output: OutputData = {
    notifications,
    totalSent,
    totalFailed,
    totalSkipped,
    sentAt: new Date().toISOString(),
  };

  await writeFile('/output/result.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nDone: ${totalSent} sent, ${totalFailed} failed, ${totalSkipped} skipped`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

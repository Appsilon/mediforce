import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Join the Community | Mediforce',
  description:
    'Join the Mediforce community on Discord. Weekly planning sessions, open-source AI agent platform for clinical trials.',
};

const DISCORD_INVITE = 'https://discord.gg/VnnJPGPS';
const DISCORD_EVENT =
  'https://discord.gg/VnnJPGPS?event=1478403250448367826';

function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 -28.5 256 256"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid"
      aria-hidden="true"
    >
      <path
        d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193a161.094 161.094 0 0 0 13.96-22.730 136.208 136.208 0 0 1-21.511-10.366c1.802-1.32 3.564-2.72 5.265-4.18 41.397 19.317 86.378 19.317 127.313 0 1.721 1.46 3.483 2.86 5.265 4.18a136.154 136.154 0 0 1-21.552 10.386 160.794 160.794 0 0 0 13.96 22.710c21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.824 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.015-11.805-23.015-26.18s10.148-26.2 23.015-26.2c12.866 0 23.236 11.824 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"
        fill="currentColor"
      />
    </svg>
  );
}

function VideoCameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-[#313338] text-white">
      {/* Header bar */}
      <header className="border-b border-white/10 bg-[#2b2d31]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(172,66%,32%)]">
              <span className="text-sm font-bold text-white font-headline">M</span>
            </div>
            <span className="text-lg font-headline font-semibold tracking-tight">
              Mediforce
            </span>
          </div>
          <span className="text-xs text-white/50">
            by Appsilon
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Hero */}
        <section className="text-center">
          <DiscordLogo className="mx-auto mb-6 h-16 w-16 text-[#5865F2]" />
          <h1 className="font-headline text-4xl font-bold tracking-tight sm:text-5xl">
            Join the <span className="text-[#5865F2]">Community</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/70">
            We&apos;re building{' '}
            <strong className="text-[hsl(172,66%,60%)]">Mediforce</strong> in
            public — an open-source platform where pharma teams and AI agents
            collaborate on real, highly regulated clinical processes.
          </p>
        </section>

        {/* Two equal cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {/* Discord card */}
          <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#5865F2]/30 bg-[#2b2d31] p-8 transition hover:border-[#5865F2]/60">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#5865F2]/10 transition group-hover:bg-[#5865F2]/20" />
            <DiscordLogo className="relative mb-4 h-10 w-10 text-[#5865F2]" />
            <h2 className="font-headline text-xl font-semibold">
              Join our Discord
            </h2>
            <p className="mt-2 text-sm text-white/60 leading-relaxed">
              Ask questions, share ideas, follow our progress, or just lurk and
              see how it evolves. This is where the conversation happens.
            </p>
            <div className="mt-auto pt-6">
              <a
                href={DISCORD_INVITE}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4752C4] focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:ring-offset-2 focus:ring-offset-[#2b2d31]"
              >
                <DiscordLogo className="h-4 w-4" />
                Join Discord Server
              </a>
            </div>
          </div>

          {/* Weekly Planning Session card */}
          <div className="group relative flex flex-col overflow-hidden rounded-2xl border-2 border-[#5865F2] bg-[#2b2d31] p-8 transition hover:border-[#5865F2]/80">
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#5865F2]/10 transition group-hover:bg-[#5865F2]/20" />

            {/* TODAY badge */}
            <div className="relative mb-4 inline-flex items-center gap-2 self-start rounded-full bg-[#5865F2] px-3 py-1 text-xs font-bold uppercase tracking-wider">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Live Today
            </div>

            <h2 className="font-headline text-xl font-semibold">
              Mediforce Weekly Planning Session
            </h2>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
              <span>3:00 PM <span className="font-normal text-white/50">CEST</span></span>
              <span>2:00 PM <span className="font-normal text-white/50">BST</span></span>
              <span>9:00 AM <span className="font-normal text-white/50">EDT</span></span>
            </div>

            {/* Agenda */}
            <ol className="mt-4 space-y-2 text-sm">
              {[
                { time: '3:00', title: 'Welcome & Quick Intros' },
                { time: '3:10', title: 'Mediforce Demo — live walkthrough' },
                { time: '3:30', title: 'Q&A — Vision & Architecture' },
                { time: '3:45', title: 'Liberating Structures — open discussion' },
              ].map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="shrink-0 w-10 text-[hsl(172,66%,60%)] font-mono text-xs leading-5">
                    {item.time}
                  </span>
                  <span className="text-white/70">{item.title}</span>
                </li>
              ))}
            </ol>

            <div className="mt-auto pt-6">
              <a
                href={DISCORD_EVENT}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4752C4] focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:ring-offset-2 focus:ring-offset-[#2b2d31]"
              >
                <VideoCameraIcon className="h-4 w-4" />
                Join the Live Session
              </a>
            </div>
          </div>
        </div>

        {/* What we're building */}
        <section className="mt-12 rounded-2xl border border-white/10 bg-[#2b2d31] p-8 sm:p-10">
          <h2 className="font-headline text-2xl font-bold">
            What is Mediforce?
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              {
                title: 'Human + AI Agents',
                description:
                  'Define how humans and agents work together: who does what, how much autonomy the agent has, and when a human must review.',
              },
              {
                title: 'Clinical Compliance',
                description:
                  'Every action is logged. Built for highly regulated pharma processes where audit trails and compliance are non-negotiable.',
              },
              {
                title: 'Open Source',
                description:
                  'Built in public by Appsilon. Follow along, contribute, or fork it. Transparency is a feature, not a bug.',
              },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="font-headline text-sm font-semibold text-[hsl(172,66%,60%)]">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm text-white/60 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-12 text-center">
          <p className="text-white/50 text-sm">
            We are working on something big at{' '}
            <strong className="text-white/80">Appsilon</strong>. 2026 is the
            year of AI agents collaborating with humans and automating
            processes.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-8 py-3 font-semibold text-white transition hover:bg-[#4752C4]"
            >
              <DiscordLogo className="h-5 w-5" />
              Join Discord
            </a>
            <a
              href={DISCORD_EVENT}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-8 py-3 font-semibold text-white transition hover:bg-white/5"
            >
              <VideoCameraIcon className="h-5 w-5" />
              Join Weekly Session
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-white/10 bg-[#2b2d31]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6 text-xs text-white/40">
          <span>Mediforce by Appsilon</span>
          <span>Open Source &middot; Built in Public</span>
        </div>
      </footer>
    </div>
  );
}

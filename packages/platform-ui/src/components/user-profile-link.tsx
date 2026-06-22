'use client';

import Link from 'next/link';

interface UserProfileLinkProps {
  displayName: string;
  personalHandle?: string;
  className?: string;
  children?: React.ReactNode;
}

export function UserProfileLink({ displayName, personalHandle, className, children }: UserProfileLinkProps) {
  const content = children ?? displayName;

  if (personalHandle === undefined) {
    return <span className={className}>{content}</span>;
  }

  return (
    <Link
      href={`/${personalHandle}`}
      className={className ?? 'hover:underline hover:text-foreground transition-colors'}
    >
      {content}
    </Link>
  );
}

type IconProps = { className?: string };

export function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 3.2 3 11h2v9h6v-6h2v6h6v-9h2L12 3.2z"
      />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm7.2 10.1 3.6 3.6-1.4 1.4-3.6-3.6 1.4-1.4z"
      />
    </svg>
  );
}

export function CommunitiesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm8 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM4 20v-2c0-2.2 2.7-4 6-4s6 1.8 6 4v2H4zm10 0v-2c0-1.1.4-2.1 1.1-3 2.3.4 4.9 1.6 4.9 3.5V20h-6z"
      />
    </svg>
  );
}

export function MessagesIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm8-6V11a8 8 0 1 0-16 0v5L2 18v1h20v-1l-2-2z"
      />
    </svg>
  );
}

export function ProfileIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"
      />
    </svg>
  );
}

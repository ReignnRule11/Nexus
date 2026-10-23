type AvatarProps = {
  name: string;
  size?: "sm" | "md" | "lg";
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1];
  return `${first}${second ?? ""}`.toUpperCase();
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

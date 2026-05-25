"use client";

interface Props {
  url?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
}

/** Square avatar with image fallback to the first letter of name / email. */
export function Avatar({ url, name, email, size = 36, className }: Props) {
  const initial = (name?.trim()?.[0] ?? email?.trim()?.[0] ?? "?").toUpperCase();
  const dim = `${size}px`;
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? email ?? "Avatar"}
        width={size}
        height={size}
        className={`rounded-full object-cover bg-surface-2 ${className ?? ""}`}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-primary/15 text-primary inline-flex items-center justify-center font-bold ${className ?? ""}`}
      style={{ width: dim, height: dim, fontSize: size * 0.4 }}
      aria-label={name ?? email ?? "Avatar"}
    >
      {initial}
    </div>
  );
}

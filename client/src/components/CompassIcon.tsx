interface Props {
  size?: number;
  className?: string;
}

/** Ícono de marca: círculo con aguja diagonal, como una brújula. */
export function CompassIcon({ size = 24, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.5 8.5L10.8 10.8L8.5 15.5L13.2 13.2L15.5 8.5Z" fill="currentColor" />
    </svg>
  );
}

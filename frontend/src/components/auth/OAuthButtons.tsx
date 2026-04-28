import { Button } from '@/components/ui/button';

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.07-1.1-.16-1.6H12z"
    />
  </svg>
);

const MicrosoftLogo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
    <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
    <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
  </svg>
);

export function OAuthButtons({ disabled }: { disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button asChild variant="outline" disabled={disabled}>
        <a href="/api/auth/google">
          <GoogleLogo />
          <span>Google</span>
        </a>
      </Button>
      <Button asChild variant="outline" disabled={disabled}>
        <a href="/api/auth/microsoft">
          <MicrosoftLogo />
          <span>Microsoft</span>
        </a>
      </Button>
    </div>
  );
}

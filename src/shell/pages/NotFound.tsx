import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@/ui';

/**
 * The catch-all route. Reached by a URL that matches nothing — including, on GitHub Pages,
 * a deep link the SPA fallback booted (dist/404.html is a copy of index.html, so the app
 * loads and then react-router decides the path is unknown). It has to look intentional
 * rather than like the platform's own 404, which is the whole reason the fallback exists.
 */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center">
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <h1 className="font-display text-base-content text-4xl font-bold tracking-[0.1em] uppercase">
          Off the boardwalk
        </h1>
        <p className="text-bw-muted max-w-sm text-sm">
          There is no pier at this address. The signs point back the way you came.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            void navigate('/');
          }}
        >
          Back to the hub
        </Button>
      </Card>
    </div>
  );
}

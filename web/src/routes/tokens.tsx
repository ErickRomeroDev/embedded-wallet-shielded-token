import { createFileRoute } from '@tanstack/react-router';
import { Tokens } from '@/pages/tokens';

export const Route = createFileRoute('/tokens')({
  component: Tokens,
});

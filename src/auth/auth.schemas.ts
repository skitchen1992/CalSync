import { z } from 'zod';

/** Google redirects with `code` on consent and `error` (e.g. access_denied) otherwise. */
export const googleCallbackQuerySchema = z.object({
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().min(1).max(200).optional(),
});

export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

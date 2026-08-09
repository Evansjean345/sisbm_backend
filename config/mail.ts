import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'

export default defineConfig({
  default: 'smtp',
  from: { address: env.get('SMTP_FROM', 'alertes@sisbm.ci'), name: 'SISBM CORE' },
  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST', 'localhost'),
      port: env.get('SMTP_PORT', 587),
      auth: env.get('SMTP_USER')
        ? { type: 'login', user: env.get('SMTP_USER')!, pass: env.get('SMTP_PASSWORD', '') }
        : undefined,
    }),
  },
})

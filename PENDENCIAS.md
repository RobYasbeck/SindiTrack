# SindiTrack — Pendências & Operação

> Status em 2026-06-29: Fases 0–4 prontas (schema, login, sync de empresas e
> recebimentos, dashboards com separação 2025/2026, geração de boletos e envio
> por e-mail). Falta destravar o envio em produção.

## 🔴 PRIORIDADE — Verificar o domínio no Resend (tira do spam)

Hoje o e-mail sai de `onboarding@resend.dev` (sandbox): **cai no spam** e **só
entrega para o dono da conta Resend** (aceyasbeck@gmail.com). Para enviar às
empresas, de verdade e na caixa de entrada:

- [ ] **resend.com/domains → Add Domain →** `senagicmg.com.br`
- [ ] Copiar os **3 registros DNS** que o Resend gera (SPF `TXT`, DKIM `CNAME/TXT`, DMARC `TXT`)
- [ ] Adicionar esses registros no painel de DNS do `senagicmg.com.br`
      (onde está hospedado: Registro.br / Cloudflare / etc.)
- [ ] No Resend, clicar **Verify** e aguardar ficar verde (minutos a algumas horas)
- [ ] Avisar a Flora → ela troca o secret `RESEND_FROM` para
      `SENAGIC MG <cobranca@senagicmg.com.br>` (hoje está `SENAGIC MG <onboarding@resend.dev>`)

Depois disso: e-mails autenticados (SPF/DKIM) → caixa de entrada, e liberados
para qualquer destinatário.

## 🟡 Envio da patronal em massa (~19.876 e-mails)

- Plano Resend **Free = 100/dia, 3.000/mês** → patronal em massa é inviável (~199 dias).
- [ ] Decidir: **subir o plano** do Resend, **ou** Flora constrói uma **fila
      server-side** (cron processa o limite diário automaticamente, retomável).
- Mensalidade (67 destinatários) já cabe no plano free.

## 🟢 Outras pendências

- [ ] **Trocar a senha do admin** (`aceyasbeck@gmail.com`) — hoje é `12345678`.
- [ ] **WhatsApp** (canal desligado): criar instância `sinditrack` no luna +
      parear com um número **AQUECIDO** (número novo toma erro 463 com contato
      "frio" — e há 22 mil contatos frios). Religar = incluir `'whatsapp'` em
      `CANAIS_ENVIO` no `app.js`.
- [ ] **Valor da mensalidade por empresa**: hoje é flat R$120 no `config`
      (os dados reais variam: 100 / 120 / 1080). Refinar se necessário.

## Referência rápida

- Supabase ref: `vtlcmevnanymdibvaeam`
- Cobranças High Gestor: mensalidade=**5976**, patronal (Contribuição Assistencial)=**6637**
- Exercício corrente: **2026** (`config.exercicio_corrente`)
- Canal de envio atual: **somente e-mail** (`CANAIS_ENVIO=['email']`)
- Secrets já configurados: `HIGESTOR_TOKEN`, `CRON_SECRET`, `EVOLUTION_API_URL/KEY` (luna), `RESEND_API_KEY`, `RESEND_FROM`

// =====================================================================
//  CONFIGURAÇÃO DO SORTEIO
//
//  • Deixando como está → o site abre em MODO DEMONSTRAÇÃO: funciona,
//    mas os dados ficam só no navegador de cada pessoa.
//
//  • Para o sorteio REAL (lista compartilhada entre todos os celulares),
//    preencha com os dados do seu projeto Supabase
//    (Supabase → Project Settings → Data API / API Keys):
//      supabaseUrl: "Project URL", ex.: https://abcdefghijk.supabase.co
//      supabaseKey: "Publishable key" (sb_publishable_...)
//                   ou, em projetos antigos, a "anon public" (eyJ...).
//
//  Essas duas informações são públicas por natureza: quem garante a
//  segurança são as regras do banco (supabase/schema.sql).
//  NUNCA coloque aqui a "secret key" / "service_role".
// =====================================================================

window.SORTEIO_CONFIG = {
  supabaseUrl: "https://axbruinxtiudmaqsygrs.supabase.co",
  supabaseKey: "sb_publishable_2Nnglfy_GUPyGNjp5MH1AA_U1f26Aqc",
};

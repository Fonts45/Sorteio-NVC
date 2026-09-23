-- =====================================================================
--  ZERAR TUDO PARA UM NOVO SORTEIO  (ATENÇÃO: apaga os dados!)
--
--  Remove todos os participantes, os bloqueios de dispositivo e o
--  histórico de sorteios, e faz os números recomeçarem do 1.
--  A senha do administrador é mantida.
--  Rode no SQL Editor somente quando quiser começar do zero.
--  (O Supabase pedirá confirmação por ser uma operação destrutiva.)
--
--  Usa DELETE (e não TRUNCATE) para que as páginas abertas recebam a
--  mudança em tempo real e já liberem o formulário.
-- =====================================================================

delete from public.sorteios;
delete from public.participantes;   -- apaga também os dispositivos (cascade)
update public.contador_numero set ultimo = 0 where id = 1;

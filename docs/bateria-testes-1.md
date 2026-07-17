BLOCO 0 — Setup e sanidade
0.1 Subir tudo do zero (down -v → up → migrate → seed) e confirmar que os 3 apps abrem (admin 5173, booking 5174, account 5175) e a API responde. Esperado: nenhum erro no console do navegador nem no log da API.

0.2 Logar no admin como gabriel, lkt e rafaelgrigio. Esperado: os três entram; lkt e rafael NÃO aparecem como opção de barbeiro pra agendar; Gabriel aparece.

0.3 Confirmar no admin que domingo aparece como fechado na agenda/expediente. Esperado: nenhum slot de domingo em lugar nenhum.

BLOCO 1 — Funil público avulso (booking, sem login)

1.1 Caminho feliz: marcar um corte avulso, pagamento presencial, ponta a ponta até a tela de sucesso. Depois confirmar no admin que apareceu na agenda do dia certo, hora certa, nome/telefone certos.

1.2 Fuso — o teste que já pegou bug antes: marcar um horário perto do limite do dia (ex: 17h30, se expediente vai até 18h). Confirmar que no admin aparece no mesmo dia e na mesma hora. Se sua máquina deixar, muda o fuso do SO pra outro (ex: Tóquio) e confirma que o horário mostrado no admin não muda.
1.3 Multi-serviço: marcar corte + barba juntos. Esperado: duração somada corretamente, preço somado, slot ocupa o tempo dos dois.

1.4 Conflito de horário: abrir duas abas, tentar marcar o mesmo horário com o mesmo barbeiro nas duas, confirmar a segunda. Esperado: a segunda falha com mensagem clara, não erro genérico feio.

1.5 Reconciliação por telefone: marcar dois agendamentos com o mesmo telefone (nomes iguais). Conferir no admin/banco que é um cliente só, não dois.

1.6 Refresh no meio: começar a marcar, chegar até a etapa de data, dar F5. Esperado: o progresso sobrevive (ou reinicia limpo — mas não quebra numa tela em branco).

1.7 Slot que acabou de encher: deixar a tela de horários aberta, marcar aquele horário por outra aba, voltar e tentar confirmar o mesmo. Esperado: erro tratado, não tela quebrada.

1.8 Barbearia fechada: tentar navegar até um domingo. Esperado: sem horários, mensagem clara de indisponível — não lista vazia sem explicação.
1.9 Telefone inválido: digitar telefone incompleto/estranho. Esperado: validação barra antes de enviar.

BLOCO 2 — Funil público de PACOTE + pagamento online (o de maior risco financeiro)
2.1 Compra de pacote online, caminho feliz: comprar "5 Cortes", pagar online (PIX demo), simular pagamento, ver a tela avançar sozinha. Esperado: confirmação, e o pacote existe no sistema como PAGO.
2.2 O teste crítico — pagou mas NÃO confirmou: gerar o PIX e não simular o pagamento. Fechar a aba. Esperado: o pacote fica AGUARDANDO, os créditos NÃO são liberados. Confirmar no admin/banco que não dá pra usar crédito de pacote não-pago. Esse é o cenário que separa sistema de pagamento sério de amador.
2.3 Idempotência do pagamento: simular o pagamento do mesmo PIX duas vezes (clicar o botão demo 2x, ou disparar o webhook 2x). Esperado: o pacote é liberado uma vez só, sem crédito duplicado, sem erro.
2.4 Pacote presencial: comprar pacote escolhendo "pagar na barbearia". Esperado: fica AGUARDANDO; confirmar como o barbeiro marca isso pago depois no admin, e que só aí os créditos liberam.
2.5 Rateio — conferir o número na tela: comprar um pacote misto (ex: 2 cortes + 2 barbas por um valor com desconto). Depois, no cockpit/admin, verificar se o valor rateado de cada item bate com a conta (soma dos rateados = valor pago, centavo a centavo).
2.6 Onboarding pós-compra: usar o "criar seu acesso agora" na tela de sucesso, com OTP. Esperado: acesso criado, e você consegue logar em seguida.
2.7 Expiração de PIX: se der pra simular/esperar um PIX expirar, ver o tratamento de EXPIRADO. Esperado: opção clara de tentar de novo.

BLOCO 3 — Cockpit do cliente (account)
3.1 Login OTP feliz: logar com telefone + código demo. Ver o pacote comprado com as fichas certas (5 disponíveis).
3.2 Telefone sem conta: tentar logar com um telefone que nunca comprou nada. Esperado: resposta neutra (não revela se existe), com caminho pra ir agendar. ← e aqui, o ponto que você levantou: um cliente que só fez agendamento avulso consegue logar? Testa e anota — provavelmente NÃO, e isso é a dor que a Sessão C resolve.
3.3 Agendar com crédito: usar um crédito do pacote, escolher dia/hora, confirmar. Esperado: "sem cobrança" explícito, ficha vira "agendada", aparece no topo como próximo agendamento.
3.4 Fichas com estados diferentes: se conseguir montar (via fixtures ou operação), ver um pacote com fichas em estados diferentes ao mesmo tempo (disponível, agendada, consumida). Esperado: cada uma visualmente distinta e correta.
3.5 Alerta de segunda chance: provocar uma falta num item de pacote (Bloco 5) e voltar ao cockpit. Esperado: alerta de prazo no topo, acima de tudo, com dias restantes.
3.6 Saldo residual: se conseguir levar um item à segunda falta (expiração), ver o saldo residual aparecer no pacote sem sumir dinheiro.
3.7 Cliente sem nenhum pacote: logar com alguém que só tem avulso (se conseguir logar). Esperado: tela funciona, não quebra, oferece algo.
3.8 Pacote de outro cliente (segurança): se tiver manha técnica, tentar acessar via API o pacote de outro cliente com seu token. Esperado: 403.

BLOCO 4 — Painel admin: agenda e conclusão (onde dinheiro é registrado)
4.1 Concluir avulso presencial: concluir um atendimento, informar forma de pagamento. Esperado: pede pagamento, registra, gera comissão.
4.2 Concluir pago-online — o bug que corrigimos: concluir um atendimento que foi pago online. Esperado: NÃO pede forma de pagamento, mostra "Pago online", conclui direto.
4.3 Walk-in add-on: num atendimento AGENDADO, adicionar uma barba antes de concluir. Esperado: entra na conta, comissão sai sobre corte+barba.
4.4 Add-on em atendimento pago-online — o canto fino: atendimento pago online, adicionar um produto na conclusão. *Esperado: "RXjaˊpagoonline+RX já pago online + R
Xjaˊpagoonline+RY a cobrar agora", pede pagamento só do adicional.*
4.5 Add-on em atendimento de CRÉDITO de pacote — a lacuna que eles acharam: num atendimento que consome crédito de pacote, adicionar um serviço avulso na conclusão. Esperado: o avulso É cobrado (não vem de graça); o crédito continua cobrindo só o item original.
4.6 Comissão rateada: concluir um atendimento de crédito de pacote e conferir no extrato: valor base = rateado, não o preço avulso cheio.
4.7 Comissão com exceção por serviço: concluir uma barba feita pelo Pedro Martins (que tem barba a 60%). Esperado: comissão sai a 60%, não a 35% padrão dele.
4.8 Cancelar antecipado: cancelar um atendimento antes do horário. Esperado: se for de crédito, libera o item sem falta.
4.9 Projeção vs saldo: olhar a tela de comissão e confirmar que "saldo real" e "projeção futura" estão separados e nunca somados.

BLOCO 5 — Ciclo de vida do pacote (a máquina de estado mais sutil)
5.1 Falta simples: cliente com crédito agenda, barbeiro marca NAO_COMPARECEU. Esperado: item vai pra SEGUNDA_CHANCE, prazo de 10 dias aparece.
5.2 Reagendar na segunda chance: o item em segunda chance, reagendar dentro do prazo. Esperado: volta a AGENDADO, prazo preservado.
5.3 Segunda falta = expira: faltar de novo no mesmo item. Esperado: item EXPIRA, valor vira saldo residual, soma do pacote continua batendo.
5.4 Cancelar antecipado com falta já computada — o loophole que fechamos: item que já tem 1 falta (em segunda chance), reagendar, e cancelar antes do horário. Esperado: volta pra SEGUNDA_CHANCE com o prazo ORIGINAL preservado — NÃO volta pra DISPONIVEL (senão o cliente burla a expiração pra sempre).
5.5 Produtos: vender um produto avulso (Bloco separado), conferir comissão de produto no extrato com badge distinta.

BLOCO 6 — Multi-barbeiro (ensaio pra Sessão B)
6.1 Agendar com o Lucas Andrade (12h-20h) num horário que só ele cobre (ex: 19h). Esperado: disponível pro Lucas, indisponível pro Gabriel/Pedro.
6.2 Confirmar que cada barbeiro só vê a própria agenda quando logado como barbeiro puro (se houver login de barbeiro puro — senão, via filtro admin).
6.3 Expediente: mudar o expediente de um barbeiro no admin e confirmar que a disponibilidade reflete (dia que estava aberto fica fechado). Esperado: materialização atualiza; dias com edição manual sobrevivem.
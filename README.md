# Atlas IP

Aplicação própria de analytics geográfico para campanhas e funis. Ela cria links rastreáveis, pede consentimento antes da coleta, registra a visita em SQLite e mostra a atividade em um globo 3D com navegação do planeta até cidades e ruas.

## O que está incluído

- Painel protegido por chave administrativa, com métricas, atividade, países e visitas recentes.
- Globo MapLibre com modos Terra, satélite e ruas, relevo, perspectiva, rotação e busca de locais.
- Fronteiras e filtros de estados do Brasil e dos Estados Unidos, além das cinco regiões brasileiras.
- Criação de campanhas com destino HTTPS e link público em `/t/:campanha`.
- Captura consentida de UTM, referência, horário, idioma, tela, navegador, sistema, dispositivo, ISP, organização, ASN e tipo de rede.
- IP mascarado, identificador HMAC, coordenadas reduzidas e exclusão automática por prazo de retenção.
- Fallback local do globo quando os provedores de mapa estiverem temporariamente indisponíveis.

## Executar localmente

Requer Node.js 22.5 ou mais recente, porque o banco usa `node:sqlite`.

```bash
npm ci
npm run dev
```

Abra `http://localhost:3000`. No desenvolvimento, a chave do painel é `atlas-dev`.

No painel, abra **Ferramentas**, informe o nome da campanha e a URL HTTPS do seu funil, salve e copie o link gerado. Um exemplo com parâmetros de campanha seria:

```text
http://localhost:3000/t/minha-campanha?utm_source=meta&utm_medium=paid-social&utm_campaign=lancamento
```

O visitante vê o aviso, escolhe se quer liberar a localização aproximada do navegador e confirma. Depois do registro, o sistema o redireciona para o destino da campanha.

## Produção

```bash
npm ci
npm run typecheck
npm run build
ATLAS_ADMIN_TOKEN='uma-chave-longa-e-aleatoria' \
ATLAS_HASH_SECRET='outra-chave-longa-e-aleatoria' \
npm start
```

Use armazenamento persistente para `.data/atlas.sqlite` ou configure `ATLAS_DB_PATH` em um volume permanente. O processo escuta `0.0.0.0:3000` por padrão e expõe `GET /api/health` para verificação de prontidão.

| Nome | Finalidade | Padrão |
| --- | --- | --- |
| `ATLAS_ADMIN_TOKEN` | Protege painel e consultas; obrigatório em produção. | nenhum |
| `ATLAS_HASH_SECRET` | Mantém os identificadores anônimos estáveis sem depender da senha do painel. | token admin |
| `ATLAS_RETENTION_DAYS` | Retenção dos registros, entre 1 e 365 dias. | `30` |
| `ATLAS_TRUST_PROXY_HOPS` | Número de proxies confiáveis antes do app; ajuste ao provedor de hospedagem. | `1` |
| `ATLAS_GEOIP_URL` | Serviço compatível com `ipwho.is`; defina como vazio para desligar GeoIP. | `https://ipwho.is` |
| `ATLAS_DB_PATH` | Arquivo SQLite persistente. | `.data/atlas.sqlite` |
| `HOST` | Interface de rede do servidor. | `0.0.0.0` |
| `PORT` | Porta HTTP. | `3000` |

O ambiente precisa permitir HTTPS de saída para:

- `ipwho.is` — localização e rede aproximadas pelo IP;
- `nominatim.openstreetmap.org` — busca de cidades e endereços;
- `tiles.openfreemap.org` — mapa de ruas;
- `server.arcgisonline.com` — imagens de satélite;
- `tiles.mapterhorn.com` — relevo 3D.

Sem acesso aos provedores cartográficos, o app ativa o globo local com as visitas e fronteiras disponíveis. Sem GeoIP, ele continua registrando os demais dados e usa coordenadas somente quando o visitante autoriza o navegador.

## Publicar no Render

Este projeto inclui um `Dockerfile`, então pode ser publicado como serviço web com backend e SQLite.

1. Envie o projeto para um repositório GitHub.
2. No Render, escolha **New > Web Service**, conecte o repositório e mantenha o runtime **Docker**.
3. Configure o health check como `/api/health`.
4. Cadastre estas variáveis no serviço:

   | Variável | Valor |
   | --- | --- |
   | `ATLAS_ADMIN_TOKEN` | uma senha longa e exclusiva para entrar no painel |
   | `ATLAS_HASH_SECRET` | outro segredo longo e exclusivo |
   | `ATLAS_RETENTION_DAYS` | `30` |
   | `ATLAS_TRUST_PROXY_HOPS` | `1` |
   | `ATLAS_GEOIP_URL` | `https://ipwho.is` |
   | `ATLAS_DB_PATH` | `/data/atlas.sqlite` |

5. Para não perder campanhas e visitas em reinicializações, adicione um disco persistente montado em `/data`. Escolha no Render um plano que aceite disco persistente.
6. Inicie a implantação. Quando o status ficar **Live**, abra a URL fornecida pelo Render e entre com o valor de `ATLAS_ADMIN_TOKEN`.

É possível fazer uma demonstração sem disco, mas o banco será temporário e poderá ser apagado quando o serviço reiniciar ou for implantado novamente.

## Privacidade e operação

- Nenhuma visita é gravada antes do consentimento explícito em `/t/:campanha`.
- O servidor recebe o IP pela conexão, mas persiste apenas uma máscara e um HMAC truncado; o IP completo não entra no banco.
- A referência externa é reduzida à origem, sem caminho ou parâmetros.
- As coordenadas são arredondadas para duas casas decimais.
- Registros antigos são removidos durante novas gravações conforme `ATLAS_RETENTION_DAYS`.
- Geolocalização por IP é aproximada e não identifica endereço ou pessoa.

Antes da publicação comercial, personalize o aviso com a identidade do responsável, contato, finalidade e base legal aplicável à operação.

## Verificação

```bash
npm test
npm run typecheck
npm run build
```

Os limites de estados usam dados simplificados do projeto Click That Hood; veja [src/data/ATTRIBUTION.md](src/data/ATTRIBUTION.md). Os mapas externos mantêm as atribuições de OpenFreeMap, OpenStreetMap, Esri e demais provedores na própria interface.

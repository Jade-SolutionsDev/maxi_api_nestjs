# CLAUDE.md

Guía para Claude Code en la API (NestJS + TypeORM).
Lee el `CLAUDE.md` de la raíz del workspace primero: allí están el stack, los
comandos y el modelo de autorización.

## Español de Cuba (obligatorio)

Todo el texto en español que ve una persona —storefront, back-office, mensajes
de la API, correos, textos sembrados en la base de datos— se escribe en el
español de Cuba, que **tutea**. Nunca voseo rioplatense: suena ajeno al cliente.

- Imperativos: **elige**, **paga**, **envía**, **recoge**, **escríbenos**,
  **confirma**, **ajusta**, **guarda**, **cambia**, **contacta**.
  Nunca *elegí*, *pagá*, *enviá*, *recogé*, *escribinos*, *confirmá*.
- Pronombres y verbos: **tú**, **tienes**, **quieres**, **puedes**, **buscas**,
  **contigo**. Nunca *vos*, *tenés*, *querés*, *podés*, *buscás*, *con vos*.
- Vale el "usted" cuando el tono lo pida, pero nunca se mezcla con el voseo.

Aplica igual a los tests: si una aserción busca un texto, se escribe como el
texto real. Los datos ya sembrados en una base de datos existente no se
actualizan solos — cámbialos desde el back-office.

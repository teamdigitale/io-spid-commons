# io-spid-commons

This repo contains:

- a passport-strategy that implements [SPID](https://www.spid.gov.it)
  authentication
- a method that configures an express endpoint to serve Service Provider
  metadata
- a scheduled procedure that refreshes IDP metadata from the [SPID
  registry](https://registry.spid.gov.it)
- a redis cache provider to validate SAML InResponseTo field

You may use this package if you're going to implement a SPID Service Provider
with a NodeJS [express server](https://expressjs.com).

## Upgrading passport-saml

Beware that any changes to the method signatures of
`SAML.prototype.generateAuthorizeRequest` and
`SAML.prototype.validatePostResponse` must be reflected inside the
[`CustomSamlClient`](./strategy/saml_client.ts) class.

That's why the version of passport-saml in package.json is currently fixed at
`1.3.5`.

## Local development

To run the project locally with the embedded example express application run the following commands:

```sh
yarn install
yarn build
docker-compose up --build
```

PS. If was present locally a previously cached version of `io-spid-commons` docker container and you get the error `Unexpected token <` on `node_modules/xml-encription/lib/templates/encrypted-key.tpl.xml.js`, is needed to clean all the old containers datas with `docker system prune --all` before running the project again.

import * as express from "express";
import { tryCatch2v } from "fp-ts/lib/Either";
import { identity } from "fp-ts/lib/function";
import { fromNullable } from "fp-ts/lib/Option";
import { SamlConfig } from "passport-saml";
import * as PassportSaml from "passport-saml";
import * as requestIp from "request-ip";
import { DoneCallbackT } from "..";
import { IExtendedCacheProvider } from "./redis_cache_provider";
import { PreValidateResponseT, XmlTamperer } from "./spid";

export class CustomSamlClient extends PassportSaml.SAML {
  constructor(
    private config: SamlConfig,
    private extededCacheProvider: IExtendedCacheProvider,
    private tamperAuthorizeRequest?: XmlTamperer,
    private preValidateResponse?: PreValidateResponseT,
    private doneCb?: DoneCallbackT
  ) {
    // validateInResponseTo must be set to false to disable
    // internal cacheProvider of passport-saml
    super({
      ...config,
      validateInResponseTo: false
    });
  }

  /**
   * Custom version of `validatePostResponse` which tampers
   * the generated XML to satisfy SPID protocol constrains
   */
  public validatePostResponse(
    body: { SAMLResponse: string },
    // tslint:disable-next-line: bool-param-default
    callback: (err: Error, profile?: unknown, loggedOut?: boolean) => void
  ): void {
    if (this.preValidateResponse) {
      return this.preValidateResponse(
        this.config,
        body,
        this.extededCacheProvider,
        (err, isValid, AuthnRequestID) => {
          if (err) {
            return callback(err);
          }
          // go on with checks in case no error is found
          return super.validatePostResponse(body, (error, __, ___) => {
            if (!error && isValid && AuthnRequestID) {
              // tslint:disable-next-line: no-floating-promises
              this.extededCacheProvider
                .remove(AuthnRequestID)
                .map(_ => callback(error, __, ___))
                .mapLeft(callback)
                .run();
            } else {
              callback(error, __, ___);
            }
          });
        }
      );
    }
    super.validatePostResponse(body, callback);
  }

  /**
   * Custom version of `generateAuthorizeRequest` which tampers
   * the generated XML to satisfy SPID protocol constrains
   */
  public generateAuthorizeRequest(
    req: express.Request,
    isPassive: boolean,
    callback: (err: Error, xml?: string) => void
  ): void {
    const newCallback = fromNullable(this.tamperAuthorizeRequest)
      .map(tamperAuthorizeRequest => (e: Error, xml?: string) => {
        xml
          ? tamperAuthorizeRequest(xml)
              .chain(tamperedXml => {
                fromNullable(this.doneCb).map(_ =>
                  tryCatch2v(
                    () => _(requestIp.getClientIp(req), tamperedXml, "REQUEST"),
                    identity
                  ).getOrElse()
                );
                return this.extededCacheProvider.save(tamperedXml, this.config);
              })
              .mapLeft(error => callback(error))
              .map(cache =>
                callback((null as unknown) as Error, cache.RequestXML)
              )
              .run()
          : callback(e);
      })
      .getOrElse(callback);
    super.generateAuthorizeRequest(req, isPassive, newCallback);
  }
}

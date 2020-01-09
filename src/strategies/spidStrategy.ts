/**
 * Builds and configure a Passport strategy to authenticate the proxy to the
 * different SPID IDPs.
 */
import { distanceInWordsToNow, isAfter, subDays } from "date-fns";
import { array } from "fp-ts/lib/Array";
import { toError } from "fp-ts/lib/Either";
import {
  fromPredicate,
  taskEither,
  TaskEither,
  tryCatch
} from "fp-ts/lib/TaskEither";
import { Strategy } from "passport";
import * as SpidStrategy from "spid-passport";
import * as x509 from "x509";
import { SpidUser } from "../types/spidUser";
import {
  fetchIdpMetadata,
  IDPOption,
  mapIpdMetadata,
  parseIdpMetadata
} from "../utils/idpLoader";
import { log } from "../utils/logger";

export const IDP_IDS: Record<string, string> = {
  "https://id.lepida.it/idp/shibboleth": "lepidaid",
  "https://identity.infocert.it": "infocertid",
  "https://identity.sieltecloud.it": "sielteid",
  "https://idp.namirialtsp.com/idp": "namirialid",
  "https://login.id.tim.it/affwebservices/public/saml2sso": "timid",
  "https://loginspid.aruba.it": "arubaid",
  "https://posteid.poste.it": "posteid",
  "https://spid.intesa.it": "intesaid",
  "https://spid.register.it": "spiditalia"
};

export interface IIoSpidStrategy extends Strategy {
  spidOptions: {
    idp: { [key: string]: IDPOption | undefined };
    // tslint:disable-next-line: no-any
    sp: any;
  };
  // tslint:disable-next-line:no-any
  logout: (req: any, callback?: (err: any, request: any) => void) => void;
  generateServiceProviderMetadata: (samlCert: string) => string;
}

/**
 * Load idp Metadata from a remote url, parse infos and return a mapped and whitelisted idp options
 * for spidStrategy object.
 */
export function loadFromRemote(
  idpMetadataUrl: string,
  idpIds: Record<string, string>
): TaskEither<Error, Record<string, IDPOption>> {
  return tryCatch(() => {
    log.info("Fetching SPID metadata from [%s]...", idpMetadataUrl);
    return fetchIdpMetadata(idpMetadataUrl);
  }, toError)
    .map(idpMetadataXML => {
      log.info("Parsing SPID metadata...");
      return parseIdpMetadata(idpMetadataXML);
    })
    .chain(
      fromPredicate(
        idpMetadata => idpMetadata.length > 0,
        () => {
          log.error("No SPID metadata found from the url: %s", idpMetadataUrl);
          return new Error("No SPID metadata found");
        }
      )
    )
    .map(idpMetadata => {
      if (idpMetadata.length < Object.keys(idpIds).length) {
        log.warn("Missing SPID metadata on [%s]", idpMetadataUrl);
      }
      log.info("Configuring IdPs...");
      return mapIpdMetadata(idpMetadata, idpIds);
    });
}

/*
 * @see https://www.agid.gov.it/sites/default/files/repository_files/regole_tecniche/tabella_attributi_idp.pdf
 */
export enum SamlAttribute {
  FAMILY_NAME = "familyName",
  NAME = "name",
  SPID_CODE = "spidCode",
  GENDER = "gender",
  FISCAL_NUMBER = "fiscalNumber",
  DATE_OF_BIRTH = "dateOfBirth",
  PLACE_OF_BIRTH = "placeOfBirth",
  COMPANY_NAME = "companyName",
  REGISTERED_OFFICE = "registeredOffice",
  IVA_CODE = "ivaCode",
  ID_CARD = "idCard",
  MOBILE_PHONE = "mobilePhone",
  EMAIL = "email",
  ADDRESS = "address",
  DIGITAL_ADDRESS = "digitalAddress"
}

export interface ISpidStrategyConfig {
  samlKey: string;
  samlCert: string;
  samlCallbackUrl: string;
  samlIssuer: string;
  samlAcceptedClockSkewMs: number;
  samlAttributeConsumingServiceIndex: number;
  spidAutologin: string;
  spidTestEnvUrl: string;
  IDPMetadataUrl: string;
  requiredAttributes: ReadonlyArray<SamlAttribute>;
  organization: {
    URL: string;
    displayName: string;
    name: string;
  };
  hasSpidValidatorEnabled: boolean;
}

export const loadSpidStrategy = (
  config: ISpidStrategyConfig
): TaskEither<Error, IIoSpidStrategy> => {
  const idpOptionsTasks = [
    loadFromRemote(config.IDPMetadataUrl, IDP_IDS)
  ].concat(
    config.hasSpidValidatorEnabled
      ? [
          loadFromRemote("https://validator.spid.gov.it/metadata.xml", {
            "https://validator.spid.gov.it": "xx_validator"
          })
        ]
      : []
  );
  return array
    .sequence(taskEither)(idpOptionsTasks)
    .map(idpOptionsRecords =>
      idpOptionsRecords.reduce((prev, current) => ({ ...prev, ...current }), {})
    )
    .map(idpOptionsRecord => {
      logSamlCertExpiration(config.samlCert);
      const options: {
        idp: { [key: string]: IDPOption | undefined };
        // tslint:disable-next-line: no-any
        sp: any;
      } = {
        idp: {
          ...idpOptionsRecord,
          xx_servizicie_test: {
            cert: [
              "MIIDdTCCAl2gAwIBAgIUU79XEfveueyClDtLkqUlSPZ2o8owDQYJKoZIhvcNAQELBQAwLTErMCkGA1UEAwwiaWRzZXJ2ZXIuc2Vydml6aWNpZS5pbnRlcm5vLmdvdi5pdDAeFw0xODEwMTkwODM1MDVaFw0zODEwMTkwODM1MDVaMC0xKzApBgNVBAMMImlkc2VydmVyLnNlcnZpemljaWUuaW50ZXJuby5nb3YuaXQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDHraj3iOTCIILTlOzicSEuFt03kKvQDqGWRd5o7s1W7SP2EtcTmg3xron/sbrLEL/eMUQV/Biz6J4pEGoFpMZQHGxOVypmO7Nc8pkFot7yUTApr6Ikuy4cUtbx0g5fkQLNb3upIg0Vg1jSnRXEvUCygr/9EeKCUOi/2ptmOVSLad+dT7TiRsZTwY3FvRWcleDfyYwcIMgz5dLSNLMZqwzQZK1DzvWeD6aGtBKCYPRftacHoESD+6bhukHZ6w95foRMJLOaBpkp+XfugFQioYvrM0AB1YQZ5DCQRhhc8jejwdY+bOB3eZ1lJY7Oannfu6XPW2fcknelyPt7PGf22rNfAgMBAAGjgYwwgYkwHQYDVR0OBBYEFK3Ah+Do3/zB9XjZ66i4biDpUEbAMGgGA1UdEQRhMF+CImlkc2VydmVyLnNlcnZpemljaWUuaW50ZXJuby5nb3YuaXSGOWh0dHBzOi8vaWRzZXJ2ZXIuc2Vydml6aWNpZS5pbnRlcm5vLmdvdi5pdC9pZHAvc2hpYmJvbGV0aDANBgkqhkiG9w0BAQsFAAOCAQEAVtpn/s+lYVf42pAtdgJnGTaSIy8KxHeZobKNYNFEY/XTaZEt9QeV5efUMBVVhxKTTHN0046DR96WFYXs4PJ9Fpyq6Hmy3k/oUdmHJ1c2bwWF/nZ82CwOO081Yg0GBcfPEmKLUGOBK8T55ncW+RSZadvWTyhTtQhLUtLKcWyzKB5aS3kEE5LSzR8sw3owln9P41Mz+QtL3WeNESRHW0qoQkFotYXXW6Rvh69+GyzJLxvq2qd7D1qoJgOMrarshBKKPk+ABaLYoEf/cru4e0RDIp2mD0jkGOGDkn9XUl+3ddALq/osTki6CEawkhiZEo6ABEAjEWNkH9W3/ZzvJnWo6Q=="
            ],
            entityID: "xx_servizicie_test",
            entryPoint:
              "https://idserver.servizicie.interno.gov.it:8443/idp/profile/SAML2/Redirect/SSO",
            logoutUrl: ""
          },
          xx_testenv2: {
            cert: [
              "MIIC7TCCAdWgAwIBAgIJAMbxPOoBth1LMA0GCSqGSIb3DQEBCwUAMA0xCzAJBgNVBAYTAklUMB4XDTE4MDkwNDE0MDAxM1oXDTE4MTAwNDE0MDAxM1owDTELMAkGA1UEBhMCSVQwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDJrW3y8Zd2jESPXGMRY04cHC4Qfo3302HEY1C6x1aDfW7aR/tXzNplfdw8ZtZugSSmHZBxVrR8aA08dUVbbtUw5qD0uAWKIeREqGfhM+J1STAMSI2/ZxA6t2fLmv8l1eRd1QGeRDm7yF9EEKGY9iUZD3LJf2mWdVBAzzYlG23M769k+9JuGZxuviNWMjojgYRiQFgzypUJJQz+Ihh3q7LMjjiQiiULVb9vnJg7UdU9Wf3xGRkxk6uiGP9SzWigSObUekYYQ4ZAI/spILywgDxVMMtv/eVniUFKLABtljn5cE9zltECahPbm7wIuMJpDDu5GYHGdYO0j+K7fhjvF2mzAgMBAAGjUDBOMB0GA1UdDgQWBBQEVmzA/L1/fd70ok+6xtDRF8A3HjAfBgNVHSMEGDAWgBQEVmzA/L1/fd70ok+6xtDRF8A3HjAMBgNVHRMEBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCRMo4M4PqS0iLTTRWfikMF4hYMapcpmuna6p8aee7CwTjS5y7y18RLvKTi9l8OI0dVkgokH8fq8/o13vMw4feGxro1hMeUilRtH52funrWC+FgPrqk3o/8cZOnq+CqnFFDfILLiEb/PVJMddvTXgv2f9O6u17f8GmMLzde1yvYDa1fG/Pi0fG2F0yw/CmtP8OTLSvxjPtJ+ZckGzZa9GotwHsoVJ+Od21OU2lOeCnOjJOAbewHgqwkCB4O4AT5RM4ThAQtoU8QibjD1XDk/ZbEHdKcofnziDyl0V8gglP2SxpzDaPX0hm4wgHk9BOtSikb72tfOw+pNfeSrZEr6ItQ"
            ],
            entityID: "xx_testenv2",
            entryPoint: `${config.spidTestEnvUrl}/sso`,
            logoutUrl: `${config.spidTestEnvUrl}/slo`
          }
        },
        sp: {
          acceptedClockSkewMs: config.samlAcceptedClockSkewMs,
          attributeConsumingServiceIndex:
            config.samlAttributeConsumingServiceIndex,
          attributes: {
            attributes: config.requiredAttributes,
            name: "Required attributes"
          },
          callbackUrl: config.samlCallbackUrl,
          decryptionPvk: config.samlKey,
          identifierFormat:
            "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
          issuer: config.samlIssuer,
          organization: config.organization,
          privateCert: config.samlKey,
          signatureAlgorithm: "sha256"
        }
      };
      const optionsWithAutoLoginInfo = {
        ...options,
        sp: {
          ...options.sp,
          additionalParams: {
            auto_login: config.spidAutologin
          }
        }
      };
      return new SpidStrategy(
        config.spidAutologin === "" ? options : optionsWithAutoLoginInfo,
        (
          profile: SpidUser,
          done: (err: Error | undefined, info: SpidUser) => void
        ) => {
          log.info(profile.getAssertionXml());
          done(undefined, profile);
        }
      ) as IIoSpidStrategy;
    });
};

/**
 * Reads dates information in x509 certificate and logs remaining time to its expiration date.
 * @param samlCert x509 certificate as string
 */
function logSamlCertExpiration(samlCert: string): void {
  try {
    const out = x509.parseCert(samlCert);
    if (out.notAfter) {
      const timeDiff = distanceInWordsToNow(out.notAfter);
      const warningDate = subDays(new Date(), 60);
      if (isAfter(out.notAfter, warningDate)) {
        log.info("samlCert expire in %s", timeDiff);
      } else if (isAfter(out.notAfter, new Date())) {
        log.warn("samlCert expire in %s", timeDiff);
      } else {
        log.error("samlCert expired from %s", timeDiff);
      }
    } else {
      log.error("Missing expiration date on saml certificate.");
    }
  } catch (e) {
    log.error("Error calculating saml cert expiration: %s", e);
  }
}

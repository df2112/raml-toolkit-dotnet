/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
// import "cross-fetch/polyfill";

import { writeFileSync, ensureDirSync } from "fs-extra";

import fetch, { Response } from "node-fetch";
import path from "path";

import { RestApi, FileInfo, Categories } from "./exchangeTypes";
import { ramlToolLogger } from "../common/logger";

const DEFAULT_DOWNLOAD_FOLDER = "download";
const ANYPOINT_BASE_URI = "https://anypoint.mulesoft.com/exchange/api/v2";
const ANYPOINT_BASE_URI_WITHOUT_VERSION =
  "https://anypoint.mulesoft.com/exchange";

export async function downloadRestApi(
  restApi: RestApi,
  destinationFolder: string = DEFAULT_DOWNLOAD_FOLDER
): Promise<void | Response> {
  if (!restApi.id) {
    ramlToolLogger.warn(
      `Failed to download '${restApi.name}' RAML as Fat RAML download information is missing.`,
      `Please download it manually from ${ANYPOINT_BASE_URI_WITHOUT_VERSION}/${restApi.groupId}/${restApi.assetId} and update the relevant details in apis/api-config.json`
    );
    return;
  }

  ensureDirSync(destinationFolder);
  const zipFilePath = path.join(destinationFolder, `${restApi.assetId}.zip`);
  const response = await fetch(restApi.fatRaml.externalLink);
  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(zipFilePath, Buffer.from(arrayBuffer));

  return response;
}

export function downloadRestApis(
  restApi: Array<RestApi>,
  destinationFolder: string = DEFAULT_DOWNLOAD_FOLDER
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promises: Promise<any>[] = [];

  restApi.forEach((api: RestApi) => {
    promises.push(downloadRestApi(api, destinationFolder));
  });

  return Promise.all(promises).then(() => destinationFolder);
}

function mapCategories(categories): Categories {
  const cats: Categories = {};
  categories.forEach(category => {
    cats[category["key"]] = category["value"];
  });
  return cats;
}

function getFileByClassifier(files, classifier): FileInfo {
  let myFile: FileInfo;
  files.forEach(file => {
    if (file["classifier"] === classifier) {
      myFile = {
        classifier: file["classifier"],
        packaging: file["packaging"],
        externalLink: file["externalLink"],
        createdDate: file["createdDate"],
        md5: file["md5"],
        sha1: file["sha1"],
        mainFile: file["mainFile"]
      };
    }
  });
  return myFile;
}

function convertResponseToRestApi(apiResponse: JSON): RestApi {
  return {
    id: apiResponse["id"],
    name: apiResponse["name"],
    description: apiResponse["description"],
    updatedDate: apiResponse["updatedDate"],
    groupId: apiResponse["groupId"],
    assetId: apiResponse["assetId"],
    version: apiResponse["version"],
    categories: mapCategories(apiResponse["categories"]),
    fatRaml: getFileByClassifier(apiResponse["files"], "fat-raml")
  };
}

/**
 * @description Get an asset from exchange.  This can be any of the following patterns
 *  * /groupId/assetId/version
 *  * /groupId/assetId
 *  * /groupId
 *
 * @export
 * @param {string} accessToken
 * @param {string} assetId
 * @returns {Promise<JSON>}
 */
export async function getAsset(
  accessToken: string,
  assetId: string
): Promise<void | JSON> {
  const res = await fetch(`${ANYPOINT_BASE_URI}/assets/${assetId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    ramlToolLogger.warn(
      `Failed to get information about ${assetId} from exchange: ${res.status} - ${res.statusText}`,
      `Please get it manually from ${ANYPOINT_BASE_URI}/assets/${assetId} and update the relevant details in apis/api-config.json`
    );
    return;
  }

  return res.json();
}

/**
 * @description Searches exchange and gets a list of apis based on the search string
 * @export
 * @param {string} accessToken
 * @param {string} searchString
 * @returns {Promise<RestApi[]>}
 */
export function searchExchange(
  accessToken: string,
  searchString: string
): Promise<RestApi[]> {
  return fetch(`${ANYPOINT_BASE_URI}/assets?search=${searchString}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })
    .then(res => res.json())
    .then(restApis => {
      const apis: RestApi[] = [];
      restApis.forEach(restApi => {
        apis.push(convertResponseToRestApi(restApi));
      });
      return apis;
    });
}

/**
 * @description Looks at all versions of an api in exchange for an instance that matched the deployment regex
 *
 * @export
 * @param {string} accessToken
 * @param {RestApi} restApi
 * @param {RegExp} deployment
 * @returns {Promise<string>} Returned the version string that matches the regex passed.  Will return first found result
 */
export async function getVersionByDeployment(
  accessToken: string,
  restApi: RestApi,
  deployment: RegExp
): Promise<void | string> {
  const asset = await getAsset(
    accessToken,
    `${restApi.groupId}/${restApi.assetId}`
  );
  if (!asset) {
    return;
  }
  let version = null;
  asset["instances"].forEach(
    (instance: { environmentName: string; version: string }) => {
      if (
        instance.environmentName &&
        deployment.test(instance.environmentName) &&
        !version
      ) {
        version = instance.version;
      }
    }
  );
  // If no instance matched the intended deployment get the version info
  // from the fetched asset.
  return version || asset["version"];
}

/**
 * @description Gets details on a very specific api version combination
 * @export
 * @param {string} accessToken
 * @param {string} groupId
 * @param {string} assetId
 * @param {string} version
 * @returns {Promise<RestApi>}
 */
export function getSpecificApi(
  accessToken: string,
  groupId: string,
  assetId: string,
  version: string
): Promise<RestApi> {
  return version
    ? getAsset(accessToken, `${groupId}/${assetId}/${version}`).then(
        (api: JSON) => {
          return api ? convertResponseToRestApi(api) : null;
        }
      )
    : null;
}
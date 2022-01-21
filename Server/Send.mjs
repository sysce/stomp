import http from 'http';
import https from 'https';
import { MapHeaderNamesFromObject, ObjectFromRawHeaders, RawHeaderNames } from '../HeaderUtil.mjs';
import messages from '../Messages.mjs';

// max of 4 concurrent sockets, rest is queued while busy? set max to 75
// const http_agent = http.Agent();
// const https_agent = https.Agent();

export async function Fetch(server_request, request_headers, url){
	const options = {
		host: url.host,
		port: url.port,
		path: url.path,
		method: server_request.method,
		headers: request_headers,
	};
	
	var request_stream;
	
	var response_promise = new Promise((resolve, reject) => {
		try{
			if(url.protocol == 'https:')request_stream = https.request(options, resolve);
			else if(url.protocol == 'http:')request_stream = http.request(options, resolve);
			else return reject(new RangeError(`Unsupported protocol: '${url.protocol}'`));
			
			request_stream.on('error', reject);
		}catch(err){
			reject(err);
		}
	});

	if(request_stream){
		server_request.pipe(request_stream);
	}
	
	return await response_promise;
}

export async function SendBare(server, server_request, server_response){
	const request_headers = Object.setPrototypeOf({}, null);
	const response_headers = Object.setPrototypeOf({}, null);
	
	if(server_request.method == 'OPTIONS'){
		response_headers['access-control-allow-headers'] = 'x-tomp-status, x-tomp-raw, x-tomp-headers, x-robots-tag';
		server_response.writeHead(200, response_headers);
		return void server_response.end();
	}

	for(let [header,value] of Object.entries(server_request.headers)){
		if(header.startsWith('accept')){
			request_headers[header] = value;
		}
	}
	
	const search = new URLSearchParams(server_request.url.slice(server_request.url.indexOf('?')));
	
	try{
		var url = JSON.parse(search.get('url'));
	}catch(err){
		return void server.send_json(server_response, 400, { message: messages['error.badbody'] });
	}

	if(!url)return void server.send_json(server_response, 400, { message: messages['error.nourlquery'] });
	
	// todo: do same procedure chrome does for capitalizing headers for http/1.0 - http/1.1 servers
	// wont recover all capitalization eg headers set by XMLHttpRequest

	try{
		var response = await Fetch(server_request, request_headers, url);
	}catch(err){
		console.error(err, url);
		throw err;
	}

	for(let header in response.headers){
		if(header == 'content-encoding' || header == 'x-content-encoding')response_headers['content-encoding'] = response.headers[header];
		else if(header == 'content-length')response_headers['content-length'] = response.headers[header];
	}

	response_headers['x-tomp-headers'] = JSON.stringify(response.headers);
	response_headers['x-tomp-raw'] = JSON.stringify(RawHeaderNames(response.rawHeaders));
	response_headers['x-tomp-status'] = response.statusCode.toString(16);
	response_headers['x-robots-tag'] = 'noindex';

	const set = new Set([...Object.keys(response_headers), ...Object.keys(server_request.headers)]);
	response_headers['access-control-allow-origin'] = '*';

	server_response.writeHead(200, response_headers);
	response.pipe(server_response);
}
//**********************************************************************************************************************************
// ERTRESTController.js
//
// The ERTRESTController is a generic interface supporting the ability to connect and receive Elektron Data Platform (EDP) HTTP 
// REST services.  The controller is intentionally designed as a reusable interface allowing appplication communcation to work with 
// any Javascript framework.
//
// Interface:
//
//      ERTRESTController()
//      ERTRESTController.get_access_token();
//      ERTRESTController.get_ERT_service();
//
// Status Events:
//      ERTRESTController.status
//
// Author: Wasin Waeosri
// Version: 1.0
// Date:    October 2018.
//**********************************************************************************************************************************

//
// TRWebSocketController()
// Quote controller instance managing connection, login and message interaction to a TR Elektron WebSocket service.
//
function ERTRESTController() {
    "use strict";

    // EDP Authentication Login request message parameters
    this._loginParams = {
        username: '',
        password: '',
        client_id: '',
        grant_type: 'password',
        takeExclusiveSignOnControl: true,
        scope: 'trapi'
    };

    // EDP Authentication Refresh Token request message parameters
    this._refreshParams = {
        username: '',
        client_id: '',
        refresh_token: '',
        grant_type: 'refresh_token',
        takeExclusiveSignOnControl: true
    };

    this.auth_obj = {};
    this._location = '';
    this.xhr = new XMLHttpRequest();

    this._hostList = '';
    this._portList = '';

    this._statusCb = null;
    this._hotStandby = false;
}

//[Modify By Wasin W.]
//
// ERTRESTController.prototype.get_access_token(option)
// Initiate an asynchronous REST connection request to EDP Authentication Server (via server.js).  Upon successful authenticaiton, the 
// framework will automatically request ERT in the Cloud Service Discovery REST API.
//
// Parameters: opt JSON
//      opt.username          EDP username.
//      opt.password          EDP password.
//      opt.client_id         EDP client ID.
//      opt.location          ERT in Cloud server location.
//      opt.refresh_token     EDP Authentication refresh token (for re-request refresh token only).
//
ERTRESTController.prototype.get_access_token = function (opt) 
{
    let refresh_token = '';

    if (opt['username']) {
        this._loginParams['username'] = opt['username'];
        this._refreshParams['username'] = opt['username'];
    }
    if (opt['clientId']) {
        this._loginParams['client_id'] = opt['clientId'];
        this._refreshParams['client_id'] = opt['clientId'];
    }
    if (opt['password']) this._loginParams['password'] = opt['password'];
    if (opt['location']) this._location = opt['location'];
    if (opt['refresh_token']) refresh_token = opt['refresh_token'];

    this.xhr.open('post', '/token', true);
    this.xhr.setRequestHeader('Accept', 'application/json');
    this.xhr.setRequestHeader('Content-Type', 'application/json');
    if (!opt['refresh_token']) {
        this.xhr.send(JSON.stringify(this._loginParams));
        console.log("Request Authentication Information with password from EDP Gateway: ", this._loginParams);
    } else {
        this.xhr.send(JSON.stringify(this._refreshParams));
        console.log("Request Authentication Information with refresh token from EDP Gateway: ", this._refreshParams);
    }
    this.xhr.onreadystatechange = () => {
        //this.xhr.onload = () => {

        if (this.xhr.readyState === 4) {
            if (this.xhr.status === 200) {
                let response_json = JSON.parse(this.xhr.responseText);
                if (response_json.access_token != null) {
                    this.auth_obj['access_token'] = response_json.access_token;
                    this.auth_obj['refresh_token'] = response_json.refresh_token;
                    this.auth_obj['expire_time'] = response_json.expires_in;

                    this._refreshParams['refresh_token'] = response_json.refresh_token;

                    if (!opt['refresh_token']) {
                        // Define the timer to refresh our token 
                        this.setRefreshTimer();
                        //if (this.isCallback(this._statusCb)) {
                        //    
                        //    this._statusCb(this.status.getToken, this.auth_obj);
                        //}
                        this.get_ERT_service(this.auth_obj);
                    } else if (opt['refresh_token']) {
                        if (this.isCallback(this._statusCb)) {
                            this._statusCb(this.status.getRefreshToken, this.auth_obj);
                        }
                    }

                }
            } else {

                let error_json = JSON.parse(this.xhr.responseText);
                if (this.isCallback(this._statusCb)) {
                    this._statusCb(this.status.authenError, error_json);
                }
            }
        }

    };
}

//[Modify By Wasin W.]
//
// ERTRESTController.prototype.get_ERT_service(authentication object)
// Initiate an asynchronous REST connection request to ERT in Cloud Service Discovery REST API (via server.js).  
// Upon successful authenticaiton, the framework will automatically notify the application to initiate ERT in Cloud Elektron WebSocket connection.
//
// Parameters: authentication JSON
//      Authentication object   {'access_token': '<EDP authentication token>', 'refresh_token' :'<EDP refresh token>', 'expire_time': 'authentication expiration time'}
//
ERTRESTController.prototype.get_ERT_service = function (auth_obj) {
    let data = {
        access_token: auth_obj.access_token,
        refresh_token: auth_obj.refresh_token,
        expire_time: auth_obj.expire_time,
        transport: 'websocket',
        dataformat: 'tr_json2'
    };

    this.xhr.open('post', '/streaming/pricing', true);
    this.xhr.setRequestHeader('Accept', 'application/json');
    this.xhr.setRequestHeader('Content-Type', 'application/json');
    this.xhr.send(JSON.stringify(data));

    this.xhr.onreadystatechange = () => {
        if (this.xhr.readyState === 4) {
            if (this.xhr.status == 200) {
                let ERT_services = JSON.parse(this.xhr.responseText);
                ERT_services['services'].forEach(element => {
                    if (this._hostList.length === 0) {
                        if (element['location'].length === 1 && element['location'] == this._location) {
                            this._hostList = element['endpoint'];
                            this._portList = element['port'];
                            return;
                        }
                    }
                    //if (!this._hotStandby) {
                    //    if (element['location'].length === 2) {
                    //        this._hostList = element['endpoint'];
                    //        this._portList = element['port'];
                    //        return;
                    //    }
                });
                
                if (this._hostList.length === 0) {
                    this._hostList = ERT_services['services'][0]['endpoint'];
                    this._portList = ERT_services['services'][0]['port'];
                    console.log(`Cannot find location: ${this._location}.  Defaulting endpoing to: ${this._hostList}`);
                }

                if (this.isCallback(this._statusCb)) {
                    this._statusCb(this.status.getService, {
                        'hostList': this._hostList,
                        'portList': this._portList,
                        'access_token': this.auth_obj.access_token
                    });
                }
            } else {
                let error_json = JSON.parse(this.xhr.responseText);
                if (this.isCallback(this._statusCb)) {
                    this._statusCb(this.status.getServiceError, error_json);
                }
            }
        }
    }
}

//[Modify By Wasin W.]
//
// ERTRESTController.prototype.setRefreshTimer()
// Initiate a timer to re-request EDP refresh token based on this.auth_obj.expire_time value.  Upon successful authenticaiton, the 
// framework will automatically re-send JSON OMM Login Reqeust message ERT in the Cloud WebSocket server.
//
//
ERTRESTController.prototype.setRefreshTimer = function () {
    let millis = (parseInt(this.auth_obj.expire_time) - 30) * 1000; //
    let intervalID = window.setInterval(() => {
        this.get_access_token({
            'refresh_token': this.auth_obj.refresh_token
        });
    }, millis);
}

//
// Status events
ERTRESTController.prototype.status = {
    authenError: 0,
    getToken: 1,
    getService: 2,
    getRefreshToken: 3,
    getServiceError: 4
};


ERTRESTController.prototype.onStatus = function (f) {
    if (this.isCallback(f)) this._statusCb = f;
}

ERTRESTController.prototype.isCallback = function (methodName) {
    return ((typeof methodName) == "function");
}
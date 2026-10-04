export namespace main {
	
	export class appInfo {
	    name: string;
	    version: string;
	    goVersion: string;
	    homepage: string;
	
	    static createFrom(source: any = {}) {
	        return new appInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.goVersion = source["goVersion"];
	        this.homepage = source["homepage"];
	    }
	}
	export class webSocketConfig {
	    url: string;
	    token: string;
	    protocol: number;
	
	    static createFrom(source: any = {}) {
	        return new webSocketConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.token = source["token"];
	        this.protocol = source["protocol"];
	    }
	}

}


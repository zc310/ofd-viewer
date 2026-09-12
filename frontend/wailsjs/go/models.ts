export namespace main {
	
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


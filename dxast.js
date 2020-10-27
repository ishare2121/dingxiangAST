const parser    = require("@babel/parser");
const traverse  = require("@babel/traverse").default;
const types     = require("@babel/types");
const generator = require("@babel/generator").default;
const fs = require('fs');

let encode_file = "./dx.js",decode_file = "./decode_dx.js";

let jscode = fs.readFileSync(encode_file, {encoding: "utf-8"});
let ast    = parser.parse(jscode);

//取出 (0,xxx) 这种格式 和 逗号表达式
const resolveSequence = {
	SequenceExpression: {
		exit(path){
			let expressions = path.get('expressions');
			let last_expression = expressions.pop();

			let statement = path.getStatementParent();

			if(statement){
				for(let expression of expressions)
				{
					if(expression.isLiteral() ||expression.isIdentifier())
					{
						expression.remove();
						continue;
					}
					statement.insertBefore(types.ExpressionStatement(expression=expression.node));
				}
				console.log(path.toString());
				path.replaceInline(last_expression);
				console.log("还原->");
				console.log(path.toString())
      }
    }
  },
};


const removeUnicode = {
	StringLiteral:{
        enter: function(path) { delete path.node.extra}
    },
};

const restoreArray = {
	"Program"(path){
		let body = path.get("body.0").node;
		let expression = body.expression;
		let argument = expression.argument;
		let {callee,arguments} = argument;
		let params = callee.params;
		for (var i=0; i<params.length;i++){
			let name = params[i].name;
			let array = arguments[i].elements;
			//获取作用域
			let scope = path.get("body.0.expression.argument.callee.body").scope;
			const binding = scope.getBinding(name);
			for (var x=0; x<binding.referencePaths.length;x++){
				let _path = binding.referencePaths[x].parentPath;
				let {object,property} = _path.node;
				let value;
				try{
					//console.log(_path.toString(),"还原->",generator(array[property.value]).code);
					_path.replaceInline(array[property.value]);
				}catch(e){
					console.log("数组还原错误->",_path.toString())
				};
			}
		}

	}
};

const restoreVar = {
    VariableDeclarator(path)
    {//还原var、let、const 定义的变量
        const {id,init} = path.node;
        if (!types.isLiteral(init)) return;//只处理字面量
        const binding = path.scope.getBinding(id.name);
        if (!binding || binding.constantViolations.length > 0)
        {//如果该变量的值被修改则不能处理
            return;
        }
        for (const refer_path of binding.referencePaths)
        {
        	//console.log(path.toString(),"还原后=>", init.value);
            refer_path.replaceWith(init);
        }
        path.remove();
    },
};

const evaluateValue={
    "UnaryExpression|BinaryExpression|CallExpression|ConditionalExpression":{
        exit:function(path){
        	const{confident,value}=path.evaluate();
        	if (confident){
        		if (value !== undefined){
        			//console.log(path.toString(),"还原后=>", value);
        			path.replaceInline(types.valueToNode(value));
        			path.skip()
				}
			}
            //console.log(value)
        }

    }
}

const evaluateValue2={
    "Identifier":{
        enter:function(path){
        	const{confident,value}=path.evaluate();
        	if (confident){
        		if (value !== undefined){
        			console.log(path.toString(),"还原后=>", value);
        			path.replaceInline(types.valueToNode(value));
				}
			}
            //console.log(value)
            //path.skip()
        }

    }
}

//还原可以通过方法直接计算出值的混淆
const restoreFunction = {
	"FunctionDeclaration"(path){
		let {id}=path.node;
        let code=path.toString();
        if(code.indexOf("try")!=-1 ||code.indexOf("random")!=-1||code.indexOf("Date")!=-1){
            return;
        };
        eval(code);
        let scope = path.scope;
        const binding = path.scope.parent.getBinding(id.name);
        if(!binding || binding.constantViolations.length>0){
            return;
        }
		for (const refer_path of binding.referencePaths){
			let call_express=refer_path.findParent(p=>p.isCallExpression());
            let arguments=call_express.get('arguments');
            let args=[];
            arguments.forEach(arg=>{args.push(arg.isLiteral())});
            if(args.length ===0 || args.indexOf("false")!=-1){
                continue;
            }
            try{
                let value= eval(call_express.toString());
                if (value !== undefined){
                	call_express.replaceInline(types.valueToNode(value));
				}
            }catch(e){
				//console.log(e);
				//console.log(call_express.toString());
            }
		}
	}
};

//还原!funtion
const restoreFunction2 = {
	"CallExpression"(path){
		let callee = path.get("callee");
		let arguments = path.get("arguments");
		if(!callee.isFunctionExpression() || arguments.length === 0)
		{
			return;
		}

		let params = callee.get('params');
		let scope = callee.scope;
		for (let i=0; i<arguments.length;i++){
			let arg = params[i];
			if (!arg) continue;
			//console.log(arg);
			let {name} = arg.node;
			const binding = scope.getBinding(name);
			if (!binding || binding.constantViolations.length > 0)
			{
				continue;
			}
			for (refer_path of binding.referencePaths){
				//console.log(path.toString())
				refer_path.replaceInline(arguments[i]);
			}
			arg.remove();
			arguments[i].remove();
		}
	}
};


//删除没被引用的var
const removeUnusedvar= {
	"VariableDeclarator"(path){
		const {id} = path.node;
		const binding = path.scope.getBinding(id.name);
		if (!binding || binding.constantViolations.length > 0)
		{
			return;
		}
		if (binding.referencePaths.length === 0){
			path.remove();
		}
	}
};

//删除没被引用的function
const removeUnusedFunc= {
	"FunctionDeclaration"(path){
		const {id} = path.node;
		const binding = path.scope.parent.getBinding(id.name);
		if (binding)
		{
			return;
		}
		console.log(path.toString())
		path.remove();
	}
};

const mergeString = {

	"BinaryExpression"(path)
	{
		//console.log(path.toString())
		const {confident,value} = path.evaluate();
		confident && path.replaceWith(types.valueToNode(value));
	},
};


const restoreReverse = {
	  "CallExpression":
	  {
	  	exit(path){
	  		console.log(path.toString());
	  		if (!types.isLiteral(path)) return;
	  		let callee = path.get('callee');
	  		if (!callee.isMemberExpression()) return;
	  		let object = callee.get('object');
	  		if (!types.isLiteral(object)) return;
	  		let value = eval(path.toString());
	  		console.log(path.toString(),"还原后=>", value);
	  		path.replaceInline(types.valueToNode(value));
	  	}
    },
};

const removeSequenceExpression = {
	ExpressionStatement: {
        enter(path){
            let {expression} = path.node;
    		if(!types.isSequenceExpression(expression)) return;
    		let body = [];
    		expression.expressions.forEach(express=>{
    			body.push(types.ExpressionStatement(express));
			});
    		path.replaceInline(body)
        }
    }
};

const evalPath = {
	"CallExpression"(path){
        var node =path.node;
        var code=path.toString();
        var value;
        if(!node.arguments.length>0)return;
        if(!types.isLiteral(node.arguments[0]))return;
        if(code.indexOf("try")!=-1 ||code.indexOf("random")!=-1||code.indexOf("Date")!=-1||code.indexOf("Math")!=-1){
            return;
        };
        try{
            value=eval("value="+code);
        }catch(e){
        }
		if (value){
			//console.log(path.toString(),"还原=>",value);
			path.replaceWith(types.valueToNode(value));
		}
    }
}

let temp_code;
traverse(ast, restoreVar);
traverse(ast, evaluateValue);
traverse(ast, restoreArray);
//为了不让节点是falsy
temp_code = generator(ast,opts = {jsescOption:{"minimal":true}}).code;
ast = parser.parse(temp_code);
traverse(ast, restoreFunction);
traverse(ast, mergeString);
traverse(ast, restoreVar);
traverse(ast, evalPath);
traverse(ast, restoreFunction);

//traverse(ast, removeSequenceExpression);
//traverse(ast, resolveSequence);
//traverse(ast, removeUnusedvar);
//traverse(ast, removeUnusedFunc);

let {code} = generator(ast,opts = {jsescOption:{"minimal":true}});
//console.log(code)
fs.writeFile(decode_file, code, (err) => {});

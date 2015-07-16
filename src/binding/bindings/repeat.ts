/// <reference path="../binding" />
/// <reference path="../../util/dom" />
/// <reference path="../../component/component" />
/// <reference path="../../template/compiler" />
/// <reference path="../../scheduler/scheduler" />
/// <reference path="../../map/map" />

module drunk {

    export interface IItemDataDescriptor {
        key: string | number;
        idx: number;
        val: any;
    }

    /**
     * 用于repeat作用域下的子viewModel
     * @param $parent     父级ViewModel
     * @param ownModel    私有的数据
     */
    export class RepeatItem extends Component {

        _isUsed: boolean;
        _isBinded: boolean;
        _placeholder: Comment = document.createComment('repeat-item');
        _element: any;

        protected _models: IModel[];

        constructor(private $parent: Component | RepeatItem, ownModel) {
            super(ownModel);
            this.__inheritParentMembers();
        }
        
        /**
         * 这里只初始化私有model
         */
        protected __init(ownModel) {
            this.__proxyModel(ownModel);
            observable.create(ownModel);
        }
        
        /**
         * 继承父级viewModel的filter和私有model
         */
        protected __inheritParentMembers() {
            let parent = this.$parent;
            let models = (<RepeatItem>parent)._models;

            super.__init(parent._model);

            this.$filter = parent.$filter;

            if (models) {
                models.forEach((model) => {
                    this.__proxyModel(model);
                });
            }
        }
        
        /**
         * 代理指定model上的所有属性
         */
        protected __proxyModel(model: IModel) {
            Object.keys(model).forEach((property) => {
                util.proxy(this, property, model);
            });

            if (!this._models) {
                this._models = [];
            }

            this._models.push(model);
        }
        
        /**
         * 重写代理方法,顺便也让父级viewModel代理该属性
         */
        $proxy(property: string) {
            if (util.proxy(this, property, this._model)) {
                this.$parent.$proxy(property);
            }
        }
        
        /**
         * 重写获取事件处理方法,忘父级查找该方法
         */
        __getHandler(handlerName: string) {
            let context: any = this;
            let handler = this[handlerName];

            while (!handler && context.parent) {
                context = context.parent;
                handler = context[handlerName];
            }

            if (!handler) {
                if (typeof window[handlerName] !== 'function') {
                    throw new Error("Handler not found: " + handlerName);
                }

                handler = window[handlerName];
                context = window;
            }

            return (...args: any[]) => {
                return handler.apply(context, args);
            };
        }
        
        /**
         * 实例释放
         */
        $release() {
            super.$release();
            this._placeholder = null;
            this._element = null;
        }

        /**
         * 把数据转成列表,如果为空则转成空数组
         * @param  target  把对象转成带有item信息的数组
         */
        static toList(target: any): IItemDataDescriptor[] {
            let ret: IItemDataDescriptor[] = [];

            if (Array.isArray(target)) {
                target.forEach((val, idx) => {
                    ret.push({
                        key: idx,
                        idx: idx,
                        val: val
                    });
                });
            }
            else if (util.isObject(target)) {
                let idx = 0;
                let key;

                for (key in target) {
                    ret.push({
                        key: key,
                        idx: idx++,
                        val: target[key]
                    });
                }
            }
            else if (typeof target === 'number') {
                for (let i = 0; i < target; i++) {
                    ret.push({
                        key: i,
                        idx: i,
                        val: i
                    });
                }
            }

            return ret;
        }
    }

    let repeaterCounter = 0;

    let regParam = /\s+in\s+/;
    let regComma = /\s*,\s*/;
    
    function invalidExpression(expression: string) {
        throw new TypeError('错误的' + config.prefix + 'repeat表达式: ' + expression);
    }

    /**
     * drunk-repeat的绑定实现类
     */
    class RepeatBinding implements IBindingDefinition {

        isTerminal: boolean;
        priority: Binding.Priority;

        element: any;
        viewModel: Component;
        expression: string;

        private _startNode: Node;
        private _endedNode: Node;
        private _param: { key?: string; val: string };
        private _bindExecutor: IBindingExecutor;
        private _itemVms: RepeatItem[];
        private _renderJob: Scheduler.IJob;
        private _map: Map<RepeatItem[]>;
        private _items: IItemDataDescriptor[];
        private _isActived: boolean;

        /**
         * 初始化绑定
         */
        init() {
            this.createCommentNodes();
            this.parseDefinition();

            this._map = new Map<RepeatItem[]>();
            this._items = [];
            this._bindExecutor = Template.compile(this.element);
        }
        
        /**
         * 创建注释标记标签
         */
        createCommentNodes() {
            this._startNode = document.createComment('repeat: ' + this.expression);
            this._endedNode = document.createComment('/repeat: ' + this.expression);

            dom.before(this._startNode, this.element);
            dom.replace(this._endedNode, this.element);
        }

        /**
         * 解析表达式定义
         */
        parseDefinition() {
            let expression: string = this.expression;
            let parts = expression.split(regParam);

            if (parts.length !== 2) {
                invalidExpression(expression);
            }

            let params: any = parts[0];
            let key: string;
            let value: string;

            if (params.indexOf(',') > 0) {
                params = params.split(regComma);
                if (params[0] === '') {
                    invalidExpression(expression);
                }
                key = params[1];
                value = params[0];
            }
            else {
                value = params;
            }

            this._param = {
                key: key,
                val: value
            };

            this.expression = parts[1].trim();
        }

        /**
         * 数据更新
         */
        update(newValue: any) {
            if (this._renderJob) {
                this._renderJob.cancel();
            }

            let items = this._items = RepeatItem.toList(newValue);
            let isEmpty = this._itemVms && this._itemVms.length > 0;
            let newVms = [];
            
            items.forEach((item, index) => {
                let itemVm = newVms[index] = this._getRepeatItem(item);
                itemVm._isUsed = true;
            });

            if (isEmpty) {
                this._unrealizeUnusedItems();
            }

            newVms.forEach(itemVm => itemVm._isUsed = false);

            this._itemVms = newVms;
            this._render();
        }

        /**
         * 渲染item元素
         */
        private _render() {
            let index = 0;
            let length = this._items.length;
            let placeholder;

            let next = (node: Node) => {
                placeholder = node.nextSibling;
                while (placeholder && (placeholder.nodeType !== 8 || placeholder.textContent != 'repeat-item')) {
                    placeholder = placeholder.nextSibling;
                }
                if (!placeholder) {
                    placeholder = this._endedNode;
                }
            };

            let renderItems = (jobInfo: Scheduler.IJobInfo) => {
                if (!this._isActived) {
                    return;
                }
                
                let viewModel: RepeatItem;
                
                // 100ms作为当前线程跑的时长，超过该时间则让出线程
                let endTime = Date.now() + 100;

                while (index < length) {
                    viewModel = this._itemVms[index++];

                    if (viewModel._placeholder !== placeholder) {
                        // 判断占位节点是否是当前item的节点，不是则换位
                        dom.before(viewModel._placeholder, placeholder);

                        if (!viewModel._isBinded) {
                            // 创建节点和生成绑定
                            viewModel.element = viewModel._element = this.element.cloneNode(true);
                            dom.after(viewModel._element, viewModel._placeholder);

                            this._bindExecutor(viewModel, viewModel.element);
                            viewModel._isBinded = true;
                        }
                        else {
                            dom.after(viewModel._element, viewModel._placeholder);
                        }

                        if (Date.now() >= endTime && index < length) {
                            // 如果创建节点达到了一定时间，让出线程给ui线程
                            return jobInfo.setPromise(Promise.resolve(renderItems));
                        }
                    }
                    else {
                        next(placeholder);
                    }
                }

                this._renderJob = null;
            };

            next(this._startNode);
            Scheduler.schedule(renderItems, Scheduler.Priority.aboveNormal);
        }

        /**
         * 根据item信息对象获取或创建RepeatItem实例
         */
        private _getRepeatItem(item: IItemDataDescriptor) {
            let value = item.val;
            let viewModelList = this._map.get(value);
            let viewModel: RepeatItem;

            if (viewModelList) {
                for (let i = 0; viewModel = viewModelList[i]; i++) {
                    if (!viewModel._isUsed) {
                        break;
                    }
                }
            }

            if (viewModel) {
                this._updateItemModel(viewModel, item);
            }
            else {
                viewModel = this._realizeRepeatItem(item);
            }

            return viewModel;
        }

        /**
         * 根据item信息对象创建RepeatItem实例
         */
        private _realizeRepeatItem(item: IItemDataDescriptor) {
            let value = item.val;
            let options: IModel = {};

            this._updateItemModel(options, item);

            let viewModel = new RepeatItem(this.viewModel, options);
            let viewModelList = this._map.get(value);

            if (!viewModelList) {
                viewModelList = [];
                this._map.set(value, viewModelList);
            }
            viewModelList.push(viewModel);

            return viewModel;
        }

        /**
         * 更新item的数据，设置$odd,$even,$last,$first的值和指定访问item信息的字段的值
         */
        private _updateItemModel(target: any, item: IItemDataDescriptor) {
            target.$odd = 0 === item.idx % 2;
            target.$even = !target.$odd;
            target.$last = item.idx === this._items.length - 1;
            target.$first = 0 === item.idx;

            target[this._param.val] = item.val;

            if (this._param.key) {
                target[this._param.key] = item.key;
            }
        }

        /**
         * 释放不再使用的RepeatItem实例并删除其指定的元素
         * @param  force  是否强制移除所有item
         */
        private _unrealizeUnusedItems(force?: boolean) {
            let nameOfVal = this._param.val;

            this._itemVms.forEach((viewModel: RepeatItem, index) => {
                if (viewModel._isUsed && !force) {
                    return;
                }

                let value = viewModel[nameOfVal];
                let viewModelList = this._map.get(value);

                util.removeArrayItem(viewModelList, viewModel);
                if (!viewModelList.length) {
                    this._map.delete(value);
                }

                let element = viewModel._element;
                let placeholder: any = viewModel._placeholder;
                
                placeholder.textContent = 'disposed repeat item';
                viewModel.$release();

                Scheduler.schedule(() => {
                    dom.remove(placeholder);
                    if (element) {
                        dom.remove(element);
                    }
                }, Scheduler.Priority.normal);
            });
        }

        /**
         * 释放该Binding实例
         */
        release() {
            if (this._itemVms && this._itemVms.length) {
                this._unrealizeUnusedItems(true);
            }
            if (this._renderJob) {
                this._renderJob.cancel();
                this._renderJob = null;
            }

            dom.remove(this._startNode);
            dom.remove(this._endedNode);
            
            this._map.clear();
            this._map = null;
            this._items = null;
            this._itemVms = null;
            this._bindExecutor = null;
            this._startNode = null;
            this._endedNode = null;
        }
    };

    RepeatBinding.prototype.isTerminal = true;
    RepeatBinding.prototype.priority = Binding.Priority.aboveNormal + 1;

    Binding.register("repeat", RepeatBinding.prototype);
}

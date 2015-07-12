/// <reference path="../binding" />
/// <reference path="../../util/dom" />

module drunk {

    Binding.register("model", {

        init() {
            let tag = this.element.tagName.toLowerCase();
            switch (tag) {
                case "input":
                    this.initInput();
                    break;
                case "select":
                    this.initSelect();
                    break;
                case "textarea":
                    this.initTextarea();
                    break;
            }

            this._changedHandler = this._changedHandler.bind(this);
            dom.on(this.element, this._changedEvent, this._changedHandler);
        },

        initInput() {
            let type = this.element.type;
            switch (type) {
                case "checkbox":
                    this.initCheckbox();
                    break;
                case "radio":
                    this.initRadio();
                    break;
                case "text":
                case "tel":
                case "email":
                case "password":
                case "search":
                    this.initTextarea();
                    break;
                default:
                    this.initCommon();
            }
        },

        initCheckbox() {
            this._changedEvent = "change";
            this._updateView = setCheckboxValue;
            this._getValue = getCheckboxValue;
        },

        initRadio() {
            this._changedEvent = "change";
            this._updateView = setRadioValue;
            this._getValue = getCommonValue;
        },

        initSelect() {
            this._changedEvent = "change";
            this._updateView = setCommonValue;
            this._getValue = getCommonValue;
        },

        initTextarea() {
            this._changedEvent = "input";
            this._updateView = setCommonValue;
            this._getValue = getCommonValue;
        },

        initCommon() {
            this._changedEvent = "change";
            this._updateView = setCommonValue;
            this._getValue = getCommonValue;
        },

        update(value) {
            this._updateView(value);
        },

        release() {
            dom.off(this.element, this._changedEvent, this._changedHandler);
        },

        _changedHandler() {
            this.setValue(this._getValue(), true);
        }

    });

    function setCheckboxValue(newValue) {
        this.element.checked = !!newValue;
    }

    function getCheckboxValue() {
        return !!this.element.checked;
    }

    function setRadioValue(newValue) {
        this.element.checked = this.element.value == newValue;
    }

    function setCommonValue(newValue) {
        newValue = newValue == null ? '' : newValue;
        this.element.value = newValue;
    }

    function getCommonValue() {
        return this.element.value;
    }

}
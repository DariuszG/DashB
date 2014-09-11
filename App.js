var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc3/doc/">App SDK 2.0rc3 Docs</a>'},
    launch: function() {
        //Write app code here
        app = this;
        app.queryIterations();
    },

    queryIterations : function() {

        var configs = [
            {
                model  : "Iteration",
                fetch  : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ],
                filters: [ Ext.create('Rally.data.wsapi.Filter', {
                    property : 'EndDate', 
                    operator: "<=", 
                    value: Rally.util.DateTime.toIsoString(new Date(), false)
                })],
                sorters: [
                    {
                        property: 'EndDate',
                        direction: 'ASC'
                    }
                ]
            }
        ];

        async.map( configs, app.wsapiQuery, function(error,results) {

            console.log(results);

            var eds = _.map( results[0], function(x) { return x.get("EndDate")});

            console.log( _.last(eds,4));

            // console.log("Iteration Results", _.last(_.map(results[0],function(x) { return x.get("EndDate")}),4));
            var last4iterations = _.last(results[0],4);

            app.iterationData( last4iterations, function(error,results){

                // 
                console.log("iteration data",results);

            });



        })
    },

    iterationData : function( iterations, callback) {

        var configs = _.map( iterations, function(iteration) {
            return {

                model  : "IterationCumulativeFlowData",
                fetch  : ['CardEstimateTotal','CardState','CreationDate'],
                filters: [ Ext.create('Rally.data.wsapi.Filter', {
                    property : 'IterationObjectID', 
                    operator: "=", 
                    value: iteration.get("ObjectID")
                })]
            };
        });

        console.log("Configs:",configs);

        async.map( configs, app.wsapiQuery, function(error,results) {

            var summaries = [];

            _.each(results,function(iterationRecords, index){ 

                var groupedByDate = _.groupBy(iterationRecords,function(ir) { return ir.get("CreationDate")});

                // console.log(groupedByDate);
                var iterationDates = _.keys(groupedByDate);
                iterationDates = _.sortBy(iterationDates,function(d) {
                    return Rally.util.DateTime.fromIsoString(d);
                });
                // console.log(iterationDates);
                var firstDayRecs = groupedByDate[_.first(iterationDates)];
                var lastDayRecs = groupedByDate[_.last(iterationDates)];

                console.log("first",firstDayRecs);
                console.log("last",lastDayRecs);

                var committed = _.reduce( firstDayRecs, function(memo,val) { 
                    return memo + (val.get("CardEstimateTotal") !== null ? val.get("CardEstimateTotal") : 0);
                }, 0 );

                var accepted = _.reduce( lastDayRecs, function(memo,val) { 

                    var estimate = val.get("CardEstimateTotal");
                    var done = val.get("CardState") === "Accepted" || val.get("CardState") === "Released";

                    return memo + ( done && !_.isNull(estimate) ) ? estimate : 0;
                }, 0 );

                summaries.push( { 

                    iteration : iterations[index].get("Name"),
                    id : firstDayRecs[0].get("IterationObjectID"),
                    committed : committed,
                    accepted : accepted

                });
            })

            console.log("summaries",summaries);

            app.addTable(summaries);

        });

    },

    addTable : function(summaries) {

        var grid = Ext.create('Rally.ui.grid.Grid', {
            store: Ext.create('Rally.data.custom.Store', {
                data: [ {
                    "summaries" : summaries
                }
                ]
            }),
            columnCfgs: [
                {
                    text: 'Last 4 Sprints', dataIndex: 'summaries', renderer : app.renderSummaries
                }
            ]
        });

        app.add(grid);

    },

    renderSummaries: function(value, metaData, record, rowIdx, colIdx, store, view) {
        console.log("value",value,record);
        return "<table>" + 
            "<tr>" + 
            "<td>" + value[0].committed + "</td>" +
            "<td>" + value[1].committed + "</td>" +
            "<td>" + value[2].committed + "</td>" +
            "<td>" + value[3].committed + "</td>" +
            "</tr>" +
            "<tr>" + 
            "<td>" + value[0].accepted + "</td>" +
            "<td>" + value[1].accepted + "</td>" +
            "<td>" + value[2].accepted + "</td>" +
            "<td>" + value[3].accepted + "</td>" +
            "</tr>" +
            "</table>";
    },

    wsapiQuery : function( config , callback ) {

        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            sorters : config.sorters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });

    }


});

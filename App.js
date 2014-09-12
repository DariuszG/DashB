var app = null;

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    // items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc3/doc/">App SDK 2.0rc3 Docs</a>'},
    launch: function() {
        app = this;
        


    app.chartConfig = 
        {
            // renderTo: Ext.getBody(),
            width: 100,
            height: 100,
            animate: true,
            store: app.gridStore,
            axes: [{
                type: 'Numeric',
                position: 'left',
                fields: ['data1', 'data2'],
                label: {
                    renderer: Ext.util.Format.numberRenderer('0,0')
                },
                title: 'Sample Values',
                grid: true,
                minimum: 0
            }, {
                type: 'Category',
                position: 'bottom',
                fields: ['name'],
                title: 'Sample Metrics'
            }],
            series: [{
                type: 'line',
                highlight: {
                    size: 7,
                    radius: 7
                },
                axis: 'left',
                xField: 'name',
                yField: 'data1',
                // markerConfig: {
                //     type: 'cross',
                //     size: 1,
                //     radius: 1,
                //     'stroke-width': 0
                // }
            }, {
                type: 'line',
                highlight: {
                    size: 7,
                    radius: 7
                },
                axis: 'left',
                fill: true,
                xField: 'name',
                yField: 'data2',
                // markerConfig: {
                //     type: 'circle',
                //     size: 1,
                //     radius: 1,
                //     'stroke-width': 0
                // }
            }]
        }

        app.queryIterations();
    },

    queryIterations : function() {

        var today = new Date();
        var lastYear = new Date();
        lastYear.setDate(today.getDate()-365);
        var todayISO = Rally.util.DateTime.toIsoString(today, false);
        var lastYearISO = Rally.util.DateTime.toIsoString(lastYear, false);
        console.log(todayISO,lastYearISO);

        var configs = [
            {
                model  : "Iteration",
                fetch  : ['Name', 'ObjectID', 'Project', 'StartDate', 'EndDate' ],
                filters: [ 
                    { property : 'EndDate', operator: "<=", value: todayISO },
                    { property : 'EndDate', operator: ">=", value: lastYearISO }
                ],
                sorters: [
                    {
                        property: 'EndDate',
                        direction: 'ASC'
                    }
                ]
            }
        ];

        async.map( configs, app.wsapiQuery, function(error,results) {

            var groupedByProject = _.groupBy(results[0],function(r) { return r.get("Project")["Name"]});

            var teams = _.keys(groupedByProject);

            var teamLastIterations = _.map( _.values(groupedByProject), function(gbp) {
                return _.last(gbp,4);
            });

            async.map( teamLastIterations, app.iterationData, function(error,results) {
                app.teamResults = _.map(results, function(result,i) { 
                    return {
                        team : teams[i],
                        summary : results[i]
                    }
                });
                app.addTable(app.teamResults);
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

        async.map( configs, app.wsapiQuery, function(error,results) {

            var summaries = [];

            _.each(results,function(iterationRecords, index){ 

                var groupedByDate = _.groupBy(iterationRecords,function(ir) { return ir.get("CreationDate")});

                var iterationDates = _.keys(groupedByDate);
                iterationDates = _.sortBy(iterationDates,function(d) {
                    return Rally.util.DateTime.fromIsoString(d);
                });

                var firstDayRecs = groupedByDate[_.first(iterationDates)];
                var lastDayRecs = groupedByDate[_.last(iterationDates)];

                var committed = _.reduce( firstDayRecs, function(memo,val) { 
                    return memo + (val.get("CardEstimateTotal") !== null ? val.get("CardEstimateTotal") : 0);
                }, 0 );

                var accepted = _.reduce( lastDayRecs, function(memo,val) { 

                    var estimate = val.get("CardEstimateTotal");
                    var done = val.get("CardState") === "Accepted" || val.get("CardState") === "Released";

                    return memo + ( done && !_.isNull(estimate) ) ? estimate : 0;
                }, 0 );

                summaries.push( { 

                    project : iterations[index].get("Project"),
                    iteration : iterations[index].get("Name"),
                    id : firstDayRecs[0].get("IterationObjectID"),
                    committed : committed,
                    accepted : accepted

                });
            })

            callback(null,summaries);

        });

    },

    addTable : function(teamResults) {

        var grid = Ext.create('Rally.ui.grid.Grid', {
            store: Ext.create('Rally.data.custom.Store', {
                data: teamResults
            }),
            columnCfgs: [
                {
                    text: 'Team', dataIndex: 'team'
                },
                {
                    text: 'Last 4 Sprints', dataIndex: 'summary', renderer : app.renderSummaries, width : 160
                },
                {
                    text: 'Chart', dataIndex: 'summary', renderer : app.renderChart,width : 150, align : "center"
                }
            ]
        });

        app.add(grid);

    },

    renderChart: function(value, metaData, record, rowIdx, colIdx, store, view) {

        var data = _.map( value, function (v,i) {
            var drec =  { 
                acceptedPercent : v.committed > 0 ? (v.accepted / v.committed) * 100 : 0,
                index : i+1,
            }
            console.log(drec);
            return drec;
        });
        
        record.chartStore = Ext.create('Ext.data.JsonStore', {
            fields: ['index','acceptedPercent'],
            data: data
        });

        record.chartConfig = 
        {
            width: 100,
            height: 100,
            axes: [{
                type: 'Numeric',
                position: 'left',
                fields: ['acceptedPercent'],
                label: {
                    renderer: Ext.util.Format.numberRenderer('0,0')
                },
                grid: true,
                minimum: 0,
                maximum: 100
            }, {
                type: 'Category',
                position: 'bottom',
                fields: ['index'],
            }],
            series: [
                {
                    type: 'line',
                    highlight: {
                        size: 2,
                        radius: 2
                    },
                    axis: 'left',
                    xField: 'index',
                    yField: 'acceptedPercent'
                }
            ]
        }

        var id = Ext.id();
        Ext.defer(function (id) {
            record.chartConfig.renderTo = id;
            record.chartConfig.store = record.chartStore;
            if (record.chart===undefined) 
                record.chart = Ext.create('Ext.chart.Chart', record.chartConfig);

            // if (record.chart!==undefined) record.chart.destroy();
            // record.chart = Ext.create('Ext.chart.Chart', record.chartConfig);
        }, 50, undefined, [id]);

        return "<div id='" + id + "'></div>";
    },

    renderSummaries: function(value, metaData, record, rowIdx, colIdx, store, view) {
        return "<table class='iteration-summary'>" + 
            "<tr>" + 
            "<td>Committed</td>" +
            "<td>" + value[0].committed + "</td>" +
            "<td>" + value[1].committed + "</td>" +
            "<td>" + value[2].committed + "</td>" +
            "<td>" + value[3].committed + "</td>" +
            "</tr>" +
            "<tr>" + 
            "<td>Accepted</td>" +
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
